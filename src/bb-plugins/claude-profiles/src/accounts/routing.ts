import type { Selection } from '../../contracts.ts';

// Stock BB gives a native send no per-draft data, so a thread's first send can
// read only the remembered composer choice. A thread started by another thread
// takes that thread's account instead, so agents keep work on one account.

export type NewThreadAccount =
  | { kind: 'inherit'; profileId: string; label: string }
  | { kind: 'composer'; profileId: string }
  | { kind: 'default' };

/** The thread whose account a new thread inherits: its parent, else the source of a fork. */
export function startingThreadId(thread: { originKind: 'fork' | null; sourceThreadId: string | null }, parentThreadId: string | null) {
  return parentThreadId ?? (thread.originKind === 'fork' ? thread.sourceThreadId : null);
}

/** A starting thread on Default counts as unbound, so the composer choice applies. */
export function newThreadAccount(startingBinding: Selection | null, composerProfileId: string | null): NewThreadAccount {
  if (startingBinding?.profile.configDir) {
    return { kind: 'inherit', profileId: startingBinding.profile.id, label: startingBinding.profile.label };
  }
  if (!composerProfileId || composerProfileId === 'default') return { kind: 'default' };
  return { kind: 'composer', profileId: composerProfileId };
}
