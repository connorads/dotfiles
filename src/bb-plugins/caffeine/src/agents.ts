// "While agents run" as a pure state machine. The lib's pidfile is the only
// record that the mode is armed (owner bb-agents); this machine adds what the
// pidfile cannot hold: how many threads run and when the grace period ends.
import { AGENTS_OWNER, type Agents, type LibStatus, type Secs } from './domain.ts';

/** How long keep-awake outlives the last busy thread. */
export const GRACE_MS = 5 * 60_000;
/** The hold is a renewable lease, so a BB that dies leaves it to expire within the hour. */
export const LEASE = 3600 as Secs;
export const LEASE_MS = LEASE * 1000;
export const RENEW_BELOW_MS = 30 * 60_000;
/** Safety net under the thread events, which can be missed across a reconnect. */
export const POLL_MS = 30_000;

/** lease is the pidfile deadline in epoch ms; null when nothing is held. */
export interface Machine { agents: Agents; lease: number | null }
export const initial: Machine = { agents: { phase: 'idle' }, lease: null };

export type Input =
  | { kind: 'arm' }
  | { kind: 'started'; ok: boolean }
  | { kind: 'busy'; n: number }
  | { kind: 'tick' }
  | { kind: 'observe'; lib: LibStatus }
  | { kind: 'userOff' }
  | { kind: 'renewed'; result: 'renewed' | 'not-owned' }
  | { kind: 'stopped' };

export type Effect =
  | { kind: 'startOwned' }
  | { kind: 'renewOwned' }
  | { kind: 'stopOwned' }
  | { kind: 'queryBusy' }
  | { kind: 'scheduleTick'; at: number }
  | { kind: 'cancelTick' };

export interface Step { machine: Machine; effects: Effect[] }

const none = (machine: Machine): Step => ({ machine, effects: [] });
const toIdle = (): Step => ({ machine: initial, effects: [{ kind: 'cancelTick' }] });

/** Grace starts at once and the busy count decides whether it stands. */
function enterGrace(lease: number | null, now: number, effects: Effect[] = []): Step {
  const until = now + GRACE_MS;
  return { machine: { agents: { phase: 'grace', until }, lease }, effects: [{ kind: 'scheduleTick', at: until }, ...effects] };
}

/** Renew while holding once under 30 min are left, and in grace if the lease would end first. */
function renewDue(machine: Machine, now: number): boolean {
  if (machine.lease === null) return false;
  if (machine.agents.phase === 'holding') return machine.lease - now < RENEW_BELOW_MS;
  if (machine.agents.phase === 'grace') return machine.lease <= machine.agents.until;
  return false;
}

const ownedBy = (lib: LibStatus) => lib.kind === 'on' && !lib.lid && lib.owner === AGENTS_OWNER;

export function step(machine: Machine, input: Input, now: number): Step {
  const armed = machine.agents.phase !== 'idle';
  switch (input.kind) {
    case 'observe': {
      const { lib } = input;
      // A start, extend or off from tmux or BB rewrites the pidfile without the
      // owner, and a lease that ran out reads OFF: either way the session is no
      // longer ours, so let go without touching it.
      if (!ownedBy(lib)) return armed ? toIdle() : none(machine);
      const lease = lib.kind === 'on' ? lib.deadline : null;
      // An owned session with an idle machine is one a previous server started:
      // adopt it, with a fresh grace that the busy count can cancel.
      if (!armed) return enterGrace(lease, now, [{ kind: 'queryBusy' }]);
      return none({ ...machine, lease });
    }
    case 'arm':
      return armed ? none(machine) : { machine, effects: [{ kind: 'startOwned' }] };
    case 'started':
      return input.ok ? enterGrace(now + LEASE_MS, now, [{ kind: 'queryBusy' }]) : none(initial);
    case 'busy': {
      if (!armed) return none(machine);
      if (input.n > 0) {
        const holding: Machine = { ...machine, agents: { phase: 'holding', busy: input.n } };
        return { machine: holding, effects: [{ kind: 'cancelTick' }, ...(renewDue(holding, now) ? [{ kind: 'renewOwned' } as const] : [])] };
      }
      if (machine.agents.phase === 'holding') return enterGrace(machine.lease, now);
      // In grace, an idle count past the deadline is the stop. The tick that
      // got here asked for this count first, so a thread that started just
      // before the deadline is still seen.
      if (machine.agents.phase === 'grace' && now >= machine.agents.until) return { machine, effects: [{ kind: 'stopOwned' }] };
      return none(machine);
    }
    case 'tick':
      if (!armed) return none(machine);
      // Renew before counting, so the count that follows sees the new lease.
      return { machine, effects: [...(renewDue(machine, now) ? [{ kind: 'renewOwned' } as const] : []), { kind: 'queryBusy' }] };
    case 'userOff':
      return armed ? { machine, effects: [{ kind: 'stopOwned' }] } : none(machine);
    case 'renewed':
      if (input.result === 'not-owned') return armed ? toIdle() : none(machine);
      return none({ ...machine, lease: now + LEASE_MS });
    case 'stopped':
      return toIdle();
  }
}
