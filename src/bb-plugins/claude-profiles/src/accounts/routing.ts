import type { Selection } from '../../contracts.ts';

// Stock BB gives a native send no per-draft data, so a thread's first send can
// read only the remembered composer choice. A thread started by another thread
// takes that thread's account instead, so agents keep work on one account.

export type NewThreadAccount =
  | { kind: 'inherit'; profileId: string; label: string }
  | { kind: 'composer'; profileId: string }
  | { kind: 'default' };

type StartedThread = { originKind: 'fork' | null; sourceThreadId: string | null; originPluginId: string | null; lifecycleOwnerThreadId: string | null };

/**
 * The thread whose account a new thread inherits: its parent, else the source of a fork, else the origin of a workflow run.
 * Workflow workers have no parent; the run's origin thread owns their lifecycle.
 */
export function startingThread(thread: StartedThread, parentThreadId: string | null) {
  if (parentThreadId) return { id: parentThreadId, workflow: false };
  if (thread.originKind === 'fork' && thread.sourceThreadId) return { id: thread.sourceThreadId, workflow: false };
  if (thread.originPluginId === 'workflows' && thread.lifecycleOwnerThreadId) return { id: thread.lifecycleOwnerThreadId, workflow: true };
  return null;
}

/**
 * Any binding passes on, Default included, so a child of a thread on Default and its own children stay on Default.
 * `defaultWhenUnbound` keeps a new thread on Default when its starting thread has no binding: a fork, because BB writes
 * the forked session under the default config directory, and a worker of a Claude workflow origin, which runs on Default.
 */
export function newThreadAccount(startingBinding: Selection | null, composerProfileId: string | null, defaultWhenUnbound = false): NewThreadAccount {
  if (startingBinding) {
    return { kind: 'inherit', profileId: startingBinding.profile.id, label: startingBinding.profile.label };
  }
  if (defaultWhenUnbound || !composerProfileId || composerProfileId === 'default') return { kind: 'default' };
  return { kind: 'composer', profileId: composerProfileId };
}
