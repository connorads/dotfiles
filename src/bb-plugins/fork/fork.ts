import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';

/** Where a fork opens. `switch` shows it in the focused pane; `sidebar` opens it in the focused thread's side panel. */
export type Placement = 'switch' | 'right' | 'left' | 'down' | 'top' | 'sidebar';

export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode';

export interface ModelChoice {
  model: string;
  label: string;
  reasoningLevel?: ReasoningLevel;
}

export interface ForkPlan {
  sourceThreadId: string;
  /** Fork after the source turn holding this event sequence. Omitted forks the tip. */
  sourceSeqEnd?: number;
  placement: Placement;
  worktree: boolean;
  /** Forks to make, 1 to 8. Omitted makes one. */
  count?: number;
  model?: ModelChoice;
  /** First prompt, sent after any model change so the first turn uses it. */
  prompt?: string;
}

type ForkSdk = Pick<PluginBrowserBbSdk, 'environments' | 'threads'>;

export const MAX_COUNT = 8;

export const CHOICES = [
  { id: 'switch', label: 'Switch to fork', icon: 'Fork' },
  { id: 'right', label: 'Split right', icon: 'Columns2' },
  { id: 'down', label: 'Split down', icon: 'Rows2' },
  { id: 'sidebar', label: 'Side panel', icon: 'SideChat' },
  { id: 'worktree', label: 'New worktree, split right', icon: 'GitBranch' },
] as const;

export function planForChoice(sourceThreadId: string, choice: string | undefined): ForkPlan | null {
  switch (choice) {
    case 'switch':
    case 'right':
    case 'down':
    case 'sidebar':
      return { sourceThreadId, placement: choice, worktree: false };
    case 'worktree':
      return { sourceThreadId, placement: 'right', worktree: true };
    default:
      return null;
  }
}

export interface Forked { id: string; title: string | null }

/** Shows a fork in a side panel tab; false when BB has no side panel to open. */
export type OpenPanel = (fork: Forked) => boolean;

export async function forkThread(sdk: ForkSdk, plan: ForkPlan): Promise<Forked[]> {
  const environment = plan.worktree ? await worktreeOnSourceMachine(sdk, plan.sourceThreadId) : undefined;
  const forks: Forked[] = [];
  for (let index = 0; index < (plan.count ?? 1); index++) {
    const forked = await sdk.threads.fork({
      sourceThreadId: plan.sourceThreadId,
      ...(plan.sourceSeqEnd === undefined ? {} : { sourceSeqEnd: plan.sourceSeqEnd }),
      ...(environment ? { environment } : {}),
    });
    if (plan.model) {
      await sdk.threads.update({
        threadId: forked.id,
        model: plan.model.model,
        ...(plan.model.reasoningLevel ? { reasoningLevel: plan.model.reasoningLevel } : {}),
      });
    }
    if (plan.prompt) {
      await sdk.threads.send({ threadId: forked.id, mode: 'start', input: [{ type: 'text', text: plan.prompt, mentions: [] }] });
    }
    // One pane can show one thread, so further switch forks stay in the sidebar.
    const split = plan.placement === 'switch' ? (index === 0 ? 'replace' : null) : plan.placement === 'sidebar' ? null : plan.placement;
    if (split) await sdk.threads.open({ threadId: forked.id, split, file: null });
    forks.push({ id: forked.id, title: forked.title });
  }
  return forks;
}

// The provider session lives on the source machine, so BB rejects a fork onto any other.
async function worktreeOnSourceMachine(sdk: ForkSdk, threadId: string) {
  const thread = await sdk.threads.get({ threadId });
  if (!thread.environmentId) throw new Error('The thread has no environment to branch a worktree from.');
  const { hostId } = await sdk.environments.get({ environmentId: thread.environmentId });
  return { type: 'host', hostId, workspace: { type: 'managed-worktree', baseBranch: { kind: 'default' } } } as const;
}

/** The `bb thread fork` command for a plan, for running the fork elsewhere. */
export function forkCommand(plan: Pick<ForkPlan, 'sourceThreadId' | 'sourceSeqEnd' | 'worktree'>): string {
  return [
    'bb thread fork', plan.sourceThreadId,
    ...(plan.sourceSeqEnd === undefined ? [] : [`--source-seq-end ${plan.sourceSeqEnd}`]),
    ...(plan.worktree ? ['--new-environment worktree'] : []),
  ].join(' ');
}

export type Notice =
  | { kind: 'busy' }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string }
  | null;

function doneMessage(plan: ForkPlan, forks: Forked[], openPanel: OpenPanel): string | null {
  if (plan.placement === 'sidebar') {
    // Open every tab before reporting; a decline leaves that fork in the sidebar only.
    const declined = forks.map(openPanel).filter(opened => !opened).length;
    if (declined) return `No side panel here. ${declined === 1 ? 'The fork is' : `${declined} forks are`} in the sidebar.`;
  }
  if (plan.placement !== 'switch') return forks.length > 1 ? `Made ${forks.length} forks.` : null;
  const title = forks[0]?.title;
  const extra = forks.length > 1 ? ` ${forks.length - 1} more in the sidebar.` : '';
  return `Now in ${title ? `fork ${title}` : 'the fork'}. Original kept in the sidebar.${extra}`;
}

// One fork at a time: a held or repeated shortcut would otherwise clone the session twice.
export function createForker() {
  let attached: ForkSdk | null = null;
  let notice: Notice = null;
  let busy = false;
  const listeners = new Set<() => void>();
  const show = (next: Notice) => {
    notice = next;
    for (const listener of listeners) listener();
  };
  return {
    attach(next: ForkSdk) {
      attached = next;
      return () => { if (attached === next) attached = null; };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notice: () => notice,
    show,
    dismiss: () => show(null),
    /** `openPanel` comes from the caller: only BB's action contexts reach the focused thread's side panel. */
    async run(plan: ForkPlan, openPanel: OpenPanel, sdk = attached): Promise<void> {
      if (busy) return;
      if (!sdk) return show({ kind: 'error', message: 'Fork is still loading. Try again.' });
      busy = true;
      show({ kind: 'busy' });
      try {
        const message = doneMessage(plan, await forkThread(sdk, plan), openPanel);
        show(message ? { kind: 'info', message } : null);
      } catch (cause) {
        show({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        busy = false;
      }
    },
  };
}
