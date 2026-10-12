// Runs on this Mac. Reads and drives keep-awake only through caffeine-lib.sh
// (see src/lib.ts) and reports state changes as `status` signals.
import { experimental_defineHostEntry, type ExperimentalHostRpcContext } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals } from './contracts.ts';
import { createCaffeineHost } from './src/lib.ts';

type Context = ExperimentalHostRpcContext<typeof hostSignals>;

/** Matches the tmux status-interval, so the chip and the pill agree within one tick. */
const rescanMs = 15_000;

const lib = createCaffeineHost();
let rescan: ReturnType<typeof setInterval> | null = null;
let lastSent = '';

/**
 * Emit only on a change. A tmux start or a caffeinate that hit its deadline is
 * seen within one rescan; the pidfile sits in ~/.cache, a busy shared tree,
 * so it is not watched.
 */
async function publish(context: Context) {
  const next = await lib.status();
  const key = JSON.stringify(next);
  if (key === lastSent) return;
  lastSent = key;
  await context.experimental_emitSignal('status', next);
}

/** Every mutation publishes at once, so the chip does not wait for the rescan. */
async function mutate<T>(context: Context, work: () => Promise<T>): Promise<T> {
  try { return await work(); } finally { await publish(context).catch(() => {}); }
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    subscribe: async (_input, context) => {
      rescan ??= setInterval(() => { void publish(context).catch(() => {}); }, rescanMs);
      // Leaves lastSent alone: this answer reaches one caller, and the next publish must still reach the rest.
      return lib.status();
    },
    details: () => lib.details(),
    start: ({ secs }, context) => mutate(context, () => lib.start(secs)),
    startLid: ({ secs }, context) => mutate(context, () => lib.startLid(secs)),
    extend: ({ add }, context) => mutate(context, () => lib.extend(add)),
    stop: (_input, context) => mutate(context, () => lib.stop()),
    startOwned: ({ secs }, context) => mutate(context, () => lib.startOwned(secs)),
    renewOwned: async ({ secs }, context) => ({ result: await mutate(context, () => lib.renewOwned(secs)) }),
    stopOwned: async (_input, context) => ({ result: await mutate(context, () => lib.stopOwned()) }),
    clear: (_input, context) => mutate(context, () => lib.clear()),
  },
  dispose: async () => {
    if (rescan) clearInterval(rescan);
    rescan = null;
  },
});
