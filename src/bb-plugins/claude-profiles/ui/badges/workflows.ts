import { z } from 'zod';
import { getBadges, subscribe } from './store.ts';
import { accountColour } from './rows.ts';

const callSchema = z.object({ label: z.string(), provider: z.string(), childThreadId: z.string().nullable() });
export const workflowViewSchema = z.object({ run: z.object({
  phases: z.array(z.object({ calls: z.array(callSchema) })), unphasedCalls: z.array(callSchema),
}).nullable() });
type Call = z.infer<typeof callSchema>;
type Loader = (threadId: string, runId: string, signal: AbortSignal) => Promise<Call[]>;
let loader: Loader | null = null;
const listeners = new Set<() => void>();
export function setWorkflowLoader(value: Loader | null) {
  loader = value;
  for (const listener of listeners) listener();
}

// Stock workflow previews expose run IDs in their directive title, but no worker IDs on rows.
export function mountWorkflowAccounts(doc: Document): () => void {
  const controller = new AbortController();
  const runs = new Map<string, { calls: Call[]; pending: boolean }>();
  const added = new Set<HTMLElement>();
  const sync = () => {
    if (controller.signal.aborted) return;
    const wanted = new Set<HTMLElement>();
    const visibleRuns = new Set<string>();
    for (const section of Array.from(doc.querySelectorAll<HTMLElement>('[data-bb-plugin="workflows"] section[aria-label="Workflow"][title]'))) {
      const runId = /^::workflow-preview\{run="(wfr_[\w-]+)"\}$/.exec(section.title)?.[1];
      const threadId = section.closest<HTMLElement>('[data-timeline-row-id]')?.dataset.timelineRowId?.split(':')[0];
      if (!runId || !threadId) continue;
      const key = `${threadId}:${runId}`;
      visibleRuns.add(key);
      let run = runs.get(key);
      if (!run && loader) {
        run = { calls: [], pending: true };
        runs.set(key, run);
        const entry = run;
        void loader(threadId, runId, controller.signal).then(calls => { entry.calls = calls; }, () => {}).finally(() => {
          entry.pending = false;
          if (!controller.signal.aborted) sync();
        });
      }
      if (!run) continue;
      for (const button of Array.from(section.querySelectorAll<HTMLButtonElement>('button'))) {
        const label = button.querySelector<HTMLElement>(':scope > span[title]')?.title;
        const matches = run.calls.filter(call => call.label === label);
        const call = matches.length === 1 ? matches[0] : undefined;
        const account = call?.provider === 'claude-code' && call.childThreadId ? getBadges().get(call.childThreadId) : undefined;
        const metadata = button.querySelector<HTMLElement>(':scope > span.ml-auto');
        if (!account || !metadata) continue;
        let badge = metadata.querySelector<HTMLElement>(':scope > .cp-workflow-account');
        if (!badge) {
          badge = doc.createElement('span');
          badge.className = 'cp-workflow-account';
          metadata.prepend(badge);
        }
        if (badge.textContent !== account.label) badge.textContent = account.label;
        const title = `Claude account: ${account.label}`;
        if (badge.title !== title) badge.title = title;
        const colour = accountColour(account.profileId);
        if (badge.style.color !== colour) badge.style.color = colour;
        wanted.add(badge);
        added.add(badge);
      }
    }
    for (const key of runs.keys()) if (!visibleRuns.has(key)) runs.delete(key);
    for (const badge of added) if (!wanted.has(badge)) { badge.remove(); added.delete(badge); }
  };
  const observer = new MutationObserver(sync);
  const unsubscribe = subscribe(sync);
  listeners.add(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-timeline-row-id'] });
  const timer = setInterval(() => {
    if (!loader || doc.visibilityState === 'hidden') return;
    for (const [key, entry] of runs) {
      if (entry.pending) continue;
      const [threadId, runId] = key.split(':');
      entry.pending = true;
      void loader(threadId, runId, controller.signal).then(calls => { entry.calls = calls; }, () => {}).finally(() => {
        entry.pending = false;
        if (!controller.signal.aborted) sync();
      });
    }
  }, 5000);
  return () => {
    controller.abort();
    clearInterval(timer);
    observer.disconnect();
    unsubscribe();
    listeners.delete(sync);
    for (const badge of added) badge.remove();
  };
}
