// Exit codes from the fixed scripts in lib.ts, turned into what the popover
// says. The lib's own codes pass through; the scripts add 9 (guard refused)
// and 10 + n (caffeine_extend_total refused with n).
import type { ActionResult } from './domain.ts';

export type Op = 'start' | 'startLid' | 'extend' | 'stop' | 'clear' | 'startOwned';
export interface Run { code: number | null; stdout: string; stderr: string }

const ok: ActionResult = { ok: true };
const fail = (reason: string, stoppedPrevious = false): ActionResult => ({ ok: false, reason, stoppedPrevious });

const NO_PMSET = 'This Mac has no pmset, so the kernel sleep flag does not exist.';
const FLAG_DID_NOT_TAKE = 'The SleepDisabled flag did not take, so closing the lid would still sleep the Mac. Nothing was started. '
  + 'Check `sudo -n /usr/bin/pmset -a disablesleep 1` works; details in ~/.cache/tmux-caffeine.log.';
const EXTEND_STOPPED = 'The session you were extending has stopped, so the Mac is no longer kept awake.';

function unknown(op: Op, run: Run): ActionResult {
  const detail = run.stderr.trim().split('\n').at(-1);
  return fail(`caffeine ${op} failed (exit ${run.code ?? 'signal'})${detail ? `: ${detail}` : ''}.`);
}

export function outcome(op: Op, run: Run): ActionResult {
  if (run.code === 0) return ok;
  switch (op) {
    case 'startLid':
      if (run.code === 3) return fail(NO_PMSET);
      if (run.code === 4) return fail(FLAG_DID_NOT_TAKE);
      if (run.code === 2) return fail('A lid session must be given a duration.');
      return unknown(op, run);
    case 'extend':
      if (run.code === 11) return fail('Nothing is running to extend.');
      if (run.code === 13) return fail('An indefinite session has nothing to extend.');
      if (run.code === 3) return fail(NO_PMSET);
      if (run.code === 4) return fail(`${FLAG_DID_NOT_TAKE} ${EXTEND_STOPPED}`, true);
      return unknown(op, run);
    case 'clear':
      if (run.code === 9) return fail('Nothing to clear.');
      return fail('sudo refused to clear the flag. Check the 20-caffeine-pmset sudoers rule.');
    default:
      return unknown(op, run);
  }
}

export const STILL_STUCK = 'The flag will not clear. The reconciler retries within 5 min.';
export const DID_NOT_START = 'caffeinate did not start.';
