import { z } from 'zod';

const callSchema = z.object({
  label: z.string(), status: z.string(), startedAt: z.number().nullable(), childThreadId: z.string().nullable(),
});
export const workflowViewSchema = z.object({ run: z.object({
  phases: z.array(z.object({ calls: z.array(callSchema) })), unphasedCalls: z.array(callSchema),
}).nullable() });
export type Call = z.infer<typeof callSchema>;
export type Source = {
  calls: (threadId: string, runId: string, signal: AbortSignal) => Promise<Call[]>;
  lastActivity: (threadId: string, signal: AbortSignal) => Promise<number | null>;
};

let source: Source | null = null;
const listeners = new Set<() => void>();
export function setSource(value: Source | null) {
  source = value;
  for (const listener of listeners) listener();
}

export const QUIET_WARN_MS = 2 * 60_000;
export const QUIET_STALL_MS = 10 * 60_000;
const REFRESH_MS = 5_000;
// A read that has not settled by then counts as failed, so the next poll can retry it.
const REQUEST_TIMEOUT_MS = 15_000;
// Copies the Workflows plugin's finished-call duration span so the timer lines up with it.
const DURATION_CLASS = 'min-w-9 whitespace-nowrap text-right text-xs tabular-nums text-subtle-foreground';

// Matches the Workflows plugin's finished-call duration format.
export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}
export function quietLevel(ms: number): 'warn' | 'stall' | null {
  return ms >= QUIET_STALL_MS ? 'stall' : ms >= QUIET_WARN_MS ? 'warn' : null;
}
const clock = (ms: number) => new Date(ms).toLocaleString();

function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }
function setAttr(el: HTMLElement, name: string, value: string | null) {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// `failed` marks that the latest read failed; `value` keeps the last good result.
type Entry<T> = { value: T; pending: boolean; failed: boolean };
type Decoration = { row: HTMLElement; live: HTMLElement; details: HTMLDetailsElement };

// Workflow rows carry no call IDs, so rows join to run data by unique label, as in claude-profiles.
export function mountWorkflowTimers(doc: Document, now: () => number = Date.now): () => void {
  const controller = new AbortController();
  const runs = new Map<string, Entry<Call[]>>();
  const activity = new Map<string, Entry<number | null>>();
  // Keyed by run and label, so a disclosure keeps its open state and focus when BB re-renders the row.
  const decorations = new Map<string, Decoration>();

  function refresh<T>(map: Map<string, Entry<T>>, key: string, initial: T, load: (s: Source, signal: AbortSignal) => Promise<T>) {
    if (!source) return;
    let entry = map.get(key);
    if (!entry) { entry = { value: initial, pending: false, failed: false }; map.set(key, entry); }
    if (entry.pending) return;
    entry.pending = true;
    const target = entry;
    const request = new AbortController();
    const stop = () => request.abort();
    controller.signal.addEventListener('abort', stop);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { request.abort(); reject(new Error('Timed out')); }, REQUEST_TIMEOUT_MS);
    });
    void Promise.race([load(source, request.signal), timeout]).then(
      value => { target.value = value; target.failed = false; },
      () => { target.failed = true; },
    ).finally(() => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', stop);
      target.pending = false;
      if (!controller.signal.aborted) sync();
    });
  }

  function remove(decoration: Decoration) {
    // Focus inside a vanishing disclosure would fall to the page body; keep it on the agent row.
    if (decoration.details.contains(doc.activeElement) && decoration.row.isConnected) decoration.row.focus();
    decoration.live.remove();
    decoration.details.remove();
  }

  function sync() {
    if (controller.signal.aborted) return;
    const at = now();
    const wanted = new Set<string>();
    const seenRuns = new Set<string>();
    const seenThreads = new Set<string>();
    for (const section of Array.from(doc.querySelectorAll<HTMLElement>('[data-bb-plugin="workflows"] section[aria-label="Workflow"][title]'))) {
      const runId = /^::workflow-preview\{run="(wfr_[\w-]+)"\}$/.exec(section.title)?.[1];
      const threadId = section.closest<HTMLElement>('[data-timeline-row-id]')?.dataset.timelineRowId?.split(':')[0];
      if (!runId || !threadId) continue;
      const key = `${threadId}:${runId}`;
      seenRuns.add(key);
      if (!runs.has(key)) refresh(runs, key, [], (s, signal) => s.calls(threadId, runId, signal));
      const calls = runs.get(key)?.value ?? [];
      const rows = Array.from(section.querySelectorAll<HTMLElement>('button')).flatMap(row => {
        const label = row.querySelector<HTMLElement>(':scope > span[title]')?.title;
        const metadata = row.querySelector<HTMLElement>(':scope > span.ml-auto');
        return label && metadata ? [{ row, label, metadata }] : [];
      });
      for (const { row, label, metadata } of rows) {
        if (rows.filter(other => other.label === label).length > 1) continue;
        const matches = calls.filter(call => call.label === label);
        const call = matches.length === 1 ? matches[0] : undefined;
        // A native duration means the row already shows the finished time.
        const native = Array.from(metadata.children).some(el => el.classList.contains('tabular-nums') && !el.classList.contains('wt-live'));
        if (!call || call.status !== 'running' || call.startedAt === null || native) continue;
        let lastAt: number | null = null;
        let readFailed = false;
        if (call.childThreadId) {
          const childId = call.childThreadId;
          seenThreads.add(childId);
          if (!activity.has(childId)) refresh(activity, childId, null, (s, signal) => s.lastActivity(childId, signal));
          lastAt = activity.get(childId)?.value ?? null;
          readFailed = activity.get(childId)?.failed ?? false;
        }
        // Without any event time a failed read must not look like a healthy worker.
        const level = lastAt === null ? (readFailed ? 'unknown' : null) : quietLevel(at - lastAt);
        const id = `${key}|${label}`;
        let decoration = decorations.get(id);
        if (!decoration) {
          const live = doc.createElement('span');
          live.className = 'wt-live tabular-nums';
          const quiet = doc.createElement('span');
          quiet.className = 'wt-quiet';
          const elapsed = doc.createElement('span');
          elapsed.className = `wt-elapsed ${DURATION_CLASS}`;
          live.append(quiet, elapsed);
          const details = doc.createElement('details');
          details.className = 'wt-details';
          const summary = doc.createElement('summary');
          summary.textContent = `Timing details for ${label}`;
          details.append(summary, doc.createElement('p'));
          decoration = { row, live, details };
          decorations.set(id, decoration);
        }
        const { live, details } = decoration;
        decoration.row = row;
        if (live.parentElement !== metadata) metadata.append(live);
        if (details.previousElementSibling !== row) row.after(details);
        setText(live.querySelector<HTMLElement>('.wt-elapsed')!, formatElapsed(at - call.startedAt));
        const quietText = level === 'unknown' ? 'quiet ?' : level && lastAt !== null ? `quiet ${Math.floor((at - lastAt) / 60_000)}m` : '';
        setText(live.querySelector<HTMLElement>('.wt-quiet')!, quietText);
        setAttr(live, 'data-quiet', level);
        const event = lastAt === null
          ? (readFailed ? ' · last thread event could not be read, retrying' : '')
          : ` · last thread event ${clock(lastAt)}${readFailed ? ' (latest read failed, retrying)' : ''}`;
        const timing = `Started ${clock(call.startedAt)}${event}`;
        setAttr(live, 'title', timing);
        setText(details.querySelector('p')!, timing);
        wanted.add(id);
      }
    }
    for (const key of runs.keys()) if (!seenRuns.has(key)) runs.delete(key);
    for (const key of activity.keys()) if (!seenThreads.has(key)) activity.delete(key);
    for (const [id, decoration] of decorations) if (!wanted.has(id)) { remove(decoration); decorations.delete(id); }
  }

  const observer = new MutationObserver(sync);
  listeners.add(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-timeline-row-id'] });
  const tick = setInterval(() => { if (doc.visibilityState !== 'hidden') sync(); }, 1000);
  const poll = setInterval(() => {
    if (doc.visibilityState === 'hidden') return;
    for (const key of runs.keys()) {
      const [threadId, runId] = key.split(':');
      refresh(runs, key, [], (s, signal) => s.calls(threadId, runId, signal));
    }
    for (const childId of activity.keys()) refresh(activity, childId, null, (s, signal) => s.lastActivity(childId, signal));
  }, REFRESH_MS);
  return () => {
    controller.abort();
    clearInterval(tick);
    clearInterval(poll);
    observer.disconnect();
    listeners.delete(sync);
    for (const { live, details } of decorations.values()) { live.remove(); details.remove(); }
    decorations.clear();
  };
}
