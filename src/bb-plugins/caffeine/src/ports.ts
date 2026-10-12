import type { ActionResult, Secs } from './domain.ts';

/** The agents controller's view of the host. Every call runs caffeine-lib.sh on this Mac. */
export interface CaffeineLib {
  /** caffeine_start SECS bb-agents, then a check that the owner reads back. */
  startOwned(secs: Secs): Promise<ActionResult>;
  /** Restarts the lease only while the pidfile still names bb-agents. */
  renewOwned(secs: Secs): Promise<'renewed' | 'not-owned'>;
  /** Stops only while the pidfile still names bb-agents. */
  stopOwned(): Promise<'stopped' | 'not-owned'>;
}

export interface Clock {
  now(): number;
  /** Run fn once after ms; the return value cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export interface ThreadStatusSource {
  /** Threads on this Mac that count as running agents. */
  busy(signal?: AbortSignal): Promise<number>;
  /** Called when a thread may have started or stopped. */
  onChange(fn: () => void): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => { const id = setTimeout(fn, Math.max(0, ms)); return () => clearTimeout(id); },
};
