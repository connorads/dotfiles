// Drives the pure step() through the ports. Every input runs on one promise
// chain, and each effect's result is fed back before the next input starts, so
// a busy count, a host status and an effect result can never interleave.
import { initial, LEASE, POLL_MS, step, type Effect, type Input, type Machine } from './agents.ts';
import type { ActionResult, Agents, LibStatus } from './domain.ts';
import type { CaffeineLib, Clock, ThreadStatusSource } from './ports.ts';

export interface AgentsController {
  readonly state: Agents;
  readonly armed: boolean;
  /** Start an owned lease. The caller has checked that keep-awake is off. */
  arm(): Promise<ActionResult>;
  /** Stop the owned session; a session someone else took over is left alone and reported as not stopped. */
  off(): Promise<ActionResult>;
  observe(lib: LibStatus): Promise<void>;
  dispose(): void;
}

export interface ControllerDeps {
  lib: CaffeineLib;
  clock: Clock;
  threads: ThreadStatusSource;
  /** Called after any change to state, so the server can publish. */
  onChange: () => void;
  log: (message: string) => void;
}

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createAgentsController({ lib, clock, threads, onChange, log }: ControllerDeps): AgentsController {
  let machine: Machine = initial;
  let chain: Promise<void> = Promise.resolve();
  let cancelTick: (() => void) | null = null;
  let cancelPoll: (() => void) | null = null;
  let lastStart: ActionResult | null = null;
  let lastStop: ActionResult | null = null;
  let disposed = false;
  const armed = () => machine.agents.phase !== 'idle';

  function serial(work: () => Promise<void>): Promise<void> {
    const next = chain.then(work);
    chain = next.catch(cause => log(`caffeine agents: ${message(cause)}`));
    return chain;
  }
  const enqueue = (input: Input) => serial(() => run(input));

  async function run(input: Input): Promise<void> {
    if (disposed) return;
    const before = machine;
    const result = step(machine, input, clock.now());
    machine = result.machine;
    if (JSON.stringify(before.agents) !== JSON.stringify(machine.agents)) onChange();
    for (const effect of result.effects) await perform(effect);
    syncPoll();
  }

  async function perform(effect: Effect): Promise<void> {
    switch (effect.kind) {
      case 'startOwned': {
        lastStart = await lib.startOwned(LEASE).catch(cause => ({ ok: false as const, reason: message(cause), stoppedPrevious: false }));
        return run({ kind: 'started', ok: lastStart.ok });
      }
      case 'renewOwned': {
        let result: 'renewed' | 'not-owned';
        try { result = await lib.renewOwned(LEASE); } catch (cause) {
          // Unreachable host: keep the old lease and try again on the next tick.
          log(`caffeine agents: renew failed: ${message(cause)}`);
          return;
        }
        return run({ kind: 'renewed', result });
      }
      case 'stopOwned':
        // A stop that cannot reach the host still disarms: the lease expires on its own within the hour.
        lastStop = await lib.stopOwned().then(
          (result): ActionResult => result === 'stopped' ? { ok: true }
            : { ok: false, reason: 'Keep-awake was changed by hand, so agents mode let it be. Turn it off again.', stoppedPrevious: false },
          (cause): ActionResult => {
            log(`caffeine agents: stop failed: ${message(cause)}`);
            return { ok: false, reason: `Could not turn off keep-awake. ${message(cause)}`, stoppedPrevious: false };
          });
        return run({ kind: 'stopped' });
      case 'queryBusy': {
        let n: number;
        try { n = await threads.busy(); } catch (cause) {
          log(`caffeine agents: counting threads failed: ${message(cause)}`);
          return;
        }
        return run({ kind: 'busy', n });
      }
      case 'scheduleTick':
        cancelTick?.();
        cancelTick = clock.after(effect.at - clock.now(), () => { cancelTick = null; void enqueue({ kind: 'tick' }); });
        return;
      case 'cancelTick':
        cancelTick?.();
        cancelTick = null;
        return;
    }
  }

  function syncPoll() {
    if (armed() && !cancelPoll && !disposed) {
      cancelPoll = clock.after(POLL_MS, () => { cancelPoll = null; void enqueue({ kind: 'tick' }); });
    } else if (!armed() && cancelPoll) {
      cancelPoll();
      cancelPoll = null;
    }
  }

  threads.onChange(() => { if (armed()) void enqueue({ kind: 'tick' }); });

  return {
    get state() { return machine.agents; },
    get armed() { return armed(); },
    async arm() {
      // Read inside the chain, so a second arm queued behind the first sees its own (absent) start.
      let result: ActionResult | null = null;
      await serial(async () => { lastStart = null; await run({ kind: 'arm' }); result = lastStart; });
      return result ?? { ok: false, reason: 'Keep-awake is already held while agents run.', stoppedPrevious: false };
    },
    async off() {
      let result: ActionResult | null = null;
      await serial(async () => { lastStop = null; await run({ kind: 'userOff' }); result = lastStop; });
      return result ?? { ok: false, reason: 'Agents mode had already let go of keep-awake.', stoppedPrevious: false };
    },
    observe: lib => enqueue({ kind: 'observe', lib }),
    dispose() {
      disposed = true;
      cancelTick?.();
      cancelPoll?.();
    },
  };
}
