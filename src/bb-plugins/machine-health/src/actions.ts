import type { Outcome } from '../contracts.ts';

export type Hibernated = { summary: string; outcomes: Outcome[]; titles: Map<string, string> };

/**
 * A thread's Stop or Hibernate and its outcome, kept outside the dialog: closing
 * mid-call must not re-arm the action or lose its result. The entry goes when a
 * dialog that has shown the outcome closes.
 */
export type Work = {
  running: 'hibernate' | 'stop' | null; hostId: string | null;
  hibernated: Hibernated | null; status: string | null; error: string | null; retry: string[] | null;
};
export const idle: Work = { running: null, hostId: null, hibernated: null, status: null, error: null, retry: null };
const work = new Map<string, Work>();
const listeners = new Set<() => void>();

export const subscribeWork = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getWork = (threadId: string): Work => work.get(threadId) ?? idle;
export function setWork(threadId: string, next: Partial<Work>) {
  work.set(threadId, { ...getWork(threadId), ...next });
  listeners.forEach(listener => listener());
}
/** A dialog closed: its outcome has been shown, so it goes, unless the action still runs. */
export function closeWork(threadId: string) {
  if (!getWork(threadId).running) work.delete(threadId);
}
/** Stop and Hibernate act on the machine, so a dialog for another thread on it waits too. */
export const runningElsewhere = (hostId: string | undefined, threadId: string) =>
  hostId !== undefined && [...work].some(([id, entry]) => id !== threadId && entry.running !== null && entry.hostId === hostId);
/** Reopened during or after a failed hibernate, the dialog starts where its ticks and button are. */
export const startView = (threadId: string): 'services' | 'threads' =>
  getWork(threadId).running === 'hibernate' || getWork(threadId).retry ? 'threads' : 'services';
export const threadCount = (count: number) => `${count} ${count === 1 ? 'thread' : 'threads'}`;
