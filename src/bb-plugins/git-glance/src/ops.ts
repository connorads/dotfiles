// One remote operation per checkout at a time. Transitions are pure: callers pass
// the current state and get the next one, or null when the event does not apply.
import type { OpState } from '../contracts.ts';
import type { Failure, Progress } from './remote.ts';

export type { OpState };
type Base = Pick<OpState, 'id' | 'kind' | 'origin' | 'startedAt'>;

/** Automatic fetches back off this long after any operation on the checkout. */
export const autoFetchQuietMs = 2 * 60_000;

export function start(current: OpState | null, next: Base, lastFetchAt: number | null): OpState | null {
  if (current?.status === 'running') return null;
  if (next.origin === 'auto') {
    const recent = Math.max(lastFetchAt ?? 0, current ? ('finishedAt' in current ? current.finishedAt : 0) : 0);
    if (next.startedAt - recent < autoFetchQuietMs) return null;
  }
  return { ...next, status: 'running', progress: null };
}

export function progress(current: OpState | null, id: string, value: Progress): OpState | null {
  if (current?.status !== 'running' || current.id !== id) return null;
  if (current.progress?.phase === value.phase && current.progress.percent === value.percent) return null;
  return { ...current, progress: value };
}

export function finish(current: OpState | null, id: string, result: { ok: true; summary: string } | { ok: false; failure: Failure }, now: number): OpState | null {
  if (current?.status !== 'running' || current.id !== id) return null;
  const { progress: _, status: __, ...base } = current;
  return result.ok ? { ...base, status: 'succeeded', summary: result.summary, finishedAt: now }
    : { ...base, status: 'failed', failure: result.failure, finishedAt: now };
}
