import { AGENTS_OWNER, type Agents, type CaffeineView, type LibStatus } from './domain.ts';

/**
 * The lib's state decides the mode; the controller only adds detail. A
 * bb-agents session reads as agents mode even before the controller adopts
 * it, so a BB restart never shows a lease as an ordinary timed session.
 */
export function compose(lib: LibStatus, agents: Agents): CaffeineView {
  switch (lib.kind) {
    case 'unsupported': return { kind: 'unsupported', reason: lib.reason };
    case 'off': return { kind: 'off' };
    case 'on':
      if (lib.lid && lib.deadline !== null) return { kind: 'lid', deadline: lib.deadline, startedAt: lib.startedAt };
      if (lib.owner === AGENTS_OWNER) {
        return {
          kind: 'agents',
          busy: agents.phase === 'holding' ? agents.busy : null,
          graceUntil: agents.phase === 'grace' ? agents.until : null,
          leaseDeadline: lib.deadline,
        };
      }
      return { kind: 'on', deadline: lib.deadline, startedAt: lib.startedAt };
  }
}
