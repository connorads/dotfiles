// The shared vocabulary. Times are epoch milliseconds throughout; the lib's
// epoch seconds are converted once, in parseStatus.

/** Must equal CAFFEINE_AGENTS_OWNER in caffeine-lib.sh: the lib reads this owner as "held by BB". */
export const AGENTS_OWNER = 'bb-agents';

/** A positive whole number of seconds, checked once at the edge. */
export type Secs = number & { readonly __secs: unique symbol };
export function parseSecs(value: number): Secs | null {
  return Number.isInteger(value) && value > 0 ? value as Secs : null;
}

export type UnsupportedReason = 'not-macos' | 'no-caffeinate' | 'no-lib' | 'no-host';

/** What the lib reports. Produced only by parseStatus(). */
export type LibStatus =
  | { kind: 'unsupported'; reason: UnsupportedReason }
  | { kind: 'off' }
  /** deadline null is indefinite. A lid session is never indefinite: the lib refuses one. */
  | { kind: 'on'; lid: boolean; pid: number; deadline: number | null; startedAt: number; owner: string | null };

/** The agents-mode controller's state, held in server memory. */
export type Agents =
  | { phase: 'idle' }
  | { phase: 'holding'; busy: number }
  | { phase: 'grace'; until: number };

/** What the app renders, composed server-side from LibStatus and Agents. */
export type CaffeineView =
  | { kind: 'unsupported'; reason: UnsupportedReason }
  | { kind: 'off' }
  | { kind: 'on'; deadline: number | null; startedAt: number }
  | { kind: 'lid'; deadline: number; startedAt: number }
  /** busy and graceUntil are both null between a BB restart and the first busy count. */
  | { kind: 'agents'; busy: number | null; graceUntil: number | null; leaseDeadline: number | null };

/** Popover-only facts. They fork pmset, so the 15 s rescan never asks for them. */
export interface Details { sleepDisabled: boolean; onBattery: boolean | null; busyNow: number }

export type ActionResult = { ok: true } | { ok: false; reason: string; stoppedPrevious: boolean };
