import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals, rpcContract } from './contracts.ts';
import { createAgentsController } from './src/agents-controller.ts';
import { busyCount } from './src/busy.ts';
import { AGENTS_OWNER, type ActionResult, type LibStatus, type UnsupportedReason } from './src/domain.ts';
import { systemClock, type CaffeineLib, type ThreadStatusSource } from './src/ports.ts';
import { compose } from './src/view.ts';

type Target = { ok: true; hostId: string } | { ok: false; reason: UnsupportedReason };
type Method = Extract<keyof typeof hostContract, string>;

/** A lid start waits up to 3 s for the flag and a stop up to 2 s for the old pid; reads are quick. */
const mutationTimeoutMs = 60_000;
const threadEvents = ['thread.active', 'thread.idle', 'thread.failed', 'thread.archived', 'thread.deleted', 'interaction.pending'] as const;

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });

  // Keep-awake is for the Mac BB runs on, which is the primary host.
  let primary: Promise<Target> | null = null;
  const target = () => primary ??= bb.sdk.system.config().then((config): Target => {
    if (!config.primaryHostId) return { ok: false, reason: 'no-host' };
    if (config.primaryHostPlatform !== 'darwin') return { ok: false, reason: 'not-macos' };
    return { ok: true, hostId: config.primaryHostId };
  }).catch(error => { primary = null; throw error; });
  const call = async <M extends Method>(method: M, input: Parameters<typeof host.call<M>>[1], timeoutMs = 20_000) => {
    const resolved = await target();
    if (!resolved.ok) throw new Error(resolved.reason === 'no-host' ? 'BB has no primary host.' : 'Keep awake needs a macOS host.');
    return host.call(method, input, { hostId: resolved.hostId, timeoutMs });
  };

  let lastLib: LibStatus | null = null;
  const publish = () => { if (lastLib) bb.realtime.publish('state', compose(lastLib, controller.state)); };

  // Thread events only matter while agents mode is armed; the controller's own poll is the safety net.
  const threadListeners: (() => void)[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const threadsChanged = () => {
    if (!controller.armed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; threadListeners.forEach(listener => listener()); }, 250);
  };
  for (const event of threadEvents) bb.events.on(event, () => threadsChanged());

  const threads: ThreadStatusSource = {
    busy: async signal => {
      const resolved = await target();
      if (!resolved.ok) return 0;
      // Only this Mac: threads on remote hosts keep their own machines awake.
      const [running, rows] = await Promise.all([
        bb.sdk.threads.listRunning({ signal }),
        bb.sdk.threads.list({ hostId: resolved.hostId, archived: false, includeHidden: true, signal }),
      ]);
      return busyCount(running, rows, resolved.hostId);
    },
    onChange: listener => { threadListeners.push(listener); },
  };

  const lib: CaffeineLib = {
    startOwned: secs => call('startOwned', { secs }, mutationTimeoutMs),
    renewOwned: async secs => (await call('renewOwned', { secs }, mutationTimeoutMs)).result,
    stopOwned: async () => (await call('stopOwned', {}, mutationTimeoutMs)).result,
  };
  const controller = createAgentsController({
    lib, threads, clock: systemClock, onChange: publish, log: message => bb.log.warn(message),
  });

  function accept(status: LibStatus) {
    lastLib = status;
    publish();
    void controller.observe(status);
    return status;
  }
  host.experimental_onSignal('status', ({ payload }) => { accept(payload); });

  let subscribed = false;
  async function readStatus(): Promise<LibStatus> {
    const resolved = await target();
    if (!resolved.ok) return accept({ kind: 'unsupported', reason: resolved.reason });
    const status = await call('subscribe', {});
    subscribed = true;
    return accept(status);
  }
  // A crashed or idle-stopped worker takes its rescan with it.
  host.experimental_onWorkerExit(() => {
    if (subscribed) readStatus().catch(error => bb.log.warn(`caffeine: re-subscribing failed: ${error}`));
  });

  // Reads the lib once at load, so an agents session left by a previous server
  // is adopted without waiting for a window to open. A host that cannot be
  // reached throws, and BB restarts the service with backoff.
  bb.background.service('agents', {
    async start(signal) {
      const connection = bb.sdk.subscribe({
        event: 'realtime:connection',
        callback: event => {
          if (event.state !== 'connected') return;
          void readStatus().catch(() => {});
          threadsChanged();
        },
      });
      try {
        await readStatus();
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        connection();
      }
    },
  });
  bb.onDispose(() => {
    controller.dispose();
    if (debounce) clearTimeout(debounce);
  });

  const refused = (reason: string): ActionResult => ({ ok: false, reason, stoppedPrevious: false });

  // Each mutation's host call publishes the new state before it returns, so the
  // handlers below need not publish themselves.
  bb.rpc.register(rpcContract, {
    state: async () => compose(await readStatus(), controller.state),
    details: async () => {
      const resolved = await target();
      if (!resolved.ok) return { sleepDisabled: false, onBattery: null, busyNow: 0 };
      const [details, busyNow] = await Promise.all([call('details', {}), threads.busy().catch(() => 0)]);
      return { ...details, busyNow };
    },
    start: input => call('start', input, mutationTimeoutMs),
    startLid: input => call('startLid', input, mutationTimeoutMs),
    extend: input => call('extend', input, mutationTimeoutMs),
    stop: async (): Promise<ActionResult> => {
      const status = await readStatus();
      if (status.kind === 'on' && status.owner === AGENTS_OWNER && controller.armed) return controller.off();
      return call('stop', {}, mutationTimeoutMs);
    },
    startAgents: async () => {
      const status = await readStatus();
      if (status.kind === 'unsupported') return refused('Keep awake is not available on this machine.');
      if (status.kind !== 'off') return refused('Keep-awake is already on. Turn it off first, then choose While agents run.');
      return controller.arm();
    },
    clearSleepDisabled: () => call('clear', {}, mutationTimeoutMs),
  });
}
