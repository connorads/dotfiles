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
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }
function setAttr(el: HTMLElement, name: string, value: string | null) {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

type Entry<T> = { value: T; pending: boolean };

// Workflow rows carry no call IDs, so rows join to run data by unique label, as in claude-profiles.
export function mountWorkflowTimers(doc: Document, now: () => number = Date.now): () => void {
  const controller = new AbortController();
  const runs = new Map<string, Entry<Call[]>>();
  const activity = new Map<string, Entry<number | null>>();
  const added = new Set<HTMLElement>();

  function refresh<T>(map: Map<string, Entry<T>>, key: string, initial: T, load: (s: Source) => Promise<T>) {
    if (!source) return;
    let entry = map.get(key);
    if (!entry) { entry = { value: initial, pending: false }; map.set(key, entry); }
    if (entry.pending) return;
    entry.pending = true;
    const target = entry;
    void load(source).then(value => { target.value = value; }, () => {}).finally(() => {
      target.pending = false;
      if (!controller.signal.aborted) sync();
    });
  }

  function sync() {
    if (controller.signal.aborted) return;
    const at = now();
    const wanted = new Set<HTMLElement>();
    const seenRuns = new Set<string>();
    const seenThreads = new Set<string>();
    for (const section of Array.from(doc.querySelectorAll<HTMLElement>('[data-bb-plugin="workflows"] section[aria-label="Workflow"][title]'))) {
      const runId = /^::workflow-preview\{run="(wfr_[\w-]+)"\}$/.exec(section.title)?.[1];
      const threadId = section.closest<HTMLElement>('[data-timeline-row-id]')?.dataset.timelineRowId?.split(':')[0];
      if (!runId || !threadId) continue;
      const key = `${threadId}:${runId}`;
      seenRuns.add(key);
      if (!runs.has(key)) refresh(runs, key, [], s => s.calls(threadId, runId, controller.signal));
      const calls = runs.get(key)?.value ?? [];
      for (const row of Array.from(section.querySelectorAll<HTMLElement>('button'))) {
        const label = row.querySelector<HTMLElement>(':scope > span[title]')?.title;
        const metadata = row.querySelector<HTMLElement>(':scope > span.ml-auto');
        if (!label || !metadata) continue;
        const matches = calls.filter(call => call.label === label);
        const call = matches.length === 1 ? matches[0] : undefined;
        // A native duration means the row already shows the finished time.
        const native = Array.from(metadata.children).some(el => el.classList.contains('tabular-nums') && !el.classList.contains('wt-live'));
        if (!call || call.status !== 'running' || call.startedAt === null || native) continue;
        let lastAt: number | null = null;
        if (call.childThreadId) {
          const childId = call.childThreadId;
          seenThreads.add(childId);
          if (!activity.has(childId)) refresh(activity, childId, null, s => s.lastActivity(childId, controller.signal));
          lastAt = activity.get(childId)?.value ?? null;
        }
        const level = lastAt === null ? null : quietLevel(at - lastAt);
        let live = metadata.querySelector<HTMLElement>(':scope > .wt-live');
        if (!live) {
          live = doc.createElement('span');
          live.className = 'wt-live tabular-nums';
          const quiet = doc.createElement('span');
          quiet.className = 'wt-quiet';
          const elapsed = doc.createElement('span');
          elapsed.className = `wt-elapsed ${DURATION_CLASS}`;
          live.append(quiet, elapsed);
          metadata.append(live);
        }
        setText(live.querySelector<HTMLElement>('.wt-elapsed')!, formatElapsed(at - call.startedAt));
        setText(live.querySelector<HTMLElement>('.wt-quiet')!, level && lastAt !== null ? `quiet ${Math.floor((at - lastAt) / 60_000)}m` : '');
        setAttr(live, 'data-quiet', level);
        setAttr(live, 'title', `Started ${clock(call.startedAt)}${lastAt === null ? '' : ` · last thread event ${clock(lastAt)}`}`);
        wanted.add(live);
        added.add(live);
      }
    }
    for (const key of runs.keys()) if (!seenRuns.has(key)) runs.delete(key);
    for (const key of activity.keys()) if (!seenThreads.has(key)) activity.delete(key);
    for (const live of added) if (!wanted.has(live)) { live.remove(); added.delete(live); }
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
      refresh(runs, key, [], s => s.calls(threadId, runId, controller.signal));
    }
    for (const childId of activity.keys()) refresh(activity, childId, null, s => s.lastActivity(childId, controller.signal));
  }, REFRESH_MS);
  return () => {
    controller.abort();
    clearInterval(tick);
    clearInterval(poll);
    observer.disconnect();
    listeners.delete(sync);
    for (const live of added) live.remove();
    added.clear();
  };
}
