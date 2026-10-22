import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';

export type Placement = 'right' | 'down' | 'sidebar';

export interface ForkPlan {
  sourceThreadId: string;
  /** Fork after the source turn holding this event sequence. Omitted forks the tip. */
  sourceSeqEnd?: number;
  placement: Placement;
  worktree: boolean;
}

type ForkSdk = Pick<PluginBrowserBbSdk, 'environments' | 'threads'>;

export const CHOICES = [
  { id: 'right', label: 'Split right', icon: 'Columns2' },
  { id: 'down', label: 'Split down', icon: 'Rows2' },
  { id: 'sidebar', label: 'Sidebar only', icon: 'Fork' },
  { id: 'worktree', label: 'New worktree, split right', icon: 'GitBranch' },
] as const;

export function planForChoice(sourceThreadId: string, choice: string | undefined): ForkPlan | null {
  switch (choice) {
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

export async function forkThread(sdk: ForkSdk, plan: ForkPlan): Promise<string> {
  const environment = plan.worktree ? await worktreeOnSourceMachine(sdk, plan.sourceThreadId) : undefined;
  const forked = await sdk.threads.fork({
    sourceThreadId: plan.sourceThreadId,
    ...(plan.sourceSeqEnd === undefined ? {} : { sourceSeqEnd: plan.sourceSeqEnd }),
    ...(environment ? { environment } : {}),
  });
  if (plan.placement !== 'sidebar') await sdk.threads.open({ threadId: forked.id, split: plan.placement, file: null });
  return forked.id;
}

// The provider session lives on the source machine, so BB rejects a fork onto any other.
async function worktreeOnSourceMachine(sdk: ForkSdk, threadId: string) {
  const thread = await sdk.threads.get({ threadId });
  if (!thread.environmentId) throw new Error('The thread has no environment to branch a worktree from.');
  const { hostId } = await sdk.environments.get({ environmentId: thread.environmentId });
  return { type: 'host', hostId, workspace: { type: 'managed-worktree', baseBranch: { kind: 'default' } } } as const;
}

export type Notice = { kind: 'busy' } | { kind: 'error'; message: string } | null;

// One fork at a time: a held or repeated shortcut would otherwise clone the session twice.
export function createForker() {
  let sdk: ForkSdk | null = null;
  let notice: Notice = null;
  let busy = false;
  const listeners = new Set<() => void>();
  const show = (next: Notice) => {
    notice = next;
    for (const listener of listeners) listener();
  };
  return {
    attach(next: ForkSdk) {
      sdk = next;
      return () => { if (sdk === next) sdk = null; };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notice: () => notice,
    dismiss: () => show(null),
    async run(plan: ForkPlan, client: ForkSdk | null = sdk): Promise<void> {
      if (busy) return;
      if (!client) return show({ kind: 'error', message: 'Fork is still loading. Try again.' });
      busy = true;
      show({ kind: 'busy' });
      try {
        await forkThread(client, plan);
        show(null);
      } catch (cause) {
        show({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        busy = false;
      }
    },
  };
}
