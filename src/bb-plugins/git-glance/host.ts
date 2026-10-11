import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals } from './contracts.ts';
import { createMonitor, type Monitor } from './src/monitor.ts';
import { commitDetail, diff, resolveRepo, type Repo } from './src/repo.ts';
import { sync } from './src/sync.ts';

const monitors = new Map<string, Promise<Monitor | null>>();
const syncing = new Set<string>();
async function required(root: string): Promise<Repo> {
  const repo = await resolveRepo(root);
  if (!repo) throw new Error(`${root} is not a git repository.`);
  return repo;
}
const syncTimeoutMs = 3 * 60_000;
const progressEveryMs = 150;

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    watch: async ({ root }, context) => {
      let monitor = monitors.get(root);
      if (!monitor) {
        monitor = resolveRepo(root).then(repo => repo && createMonitor(repo, {
          // Watch callbacks outlive this call; signals still reach the server.
          watch: (options, listener) => context.experimental_watch(options, listener),
          publish: next => { void context.experimental_emitSignal('snapshot', { root, snapshot: next }); },
          log: message => console.warn(`[git-glance] ${message}`),
        }));
        monitors.set(root, monitor);
        monitor.catch(() => monitors.delete(root));
      }
      const ready = await monitor;
      return ready ? ready.current() : { kind: 'none' as const };
    },
    unwatch: async ({ root }) => {
      const monitor = monitors.get(root);
      monitors.delete(root);
      await (await monitor?.catch(() => null))?.dispose();
      return {};
    },
    diff: async ({ root, ...input }) => diff(await required(root), input),
    commit: async ({ root, sha }) => commitDetail(await required(root), sha),
    sync: async ({ root, op, opId }, context) => {
      const repo = await resolveRepo(root);
      if (!repo) return { ok: false as const, failure: { reason: 'unknown' as const, message: `${root} is not a git repository.` } };
      if (syncing.has(root)) return { ok: false as const, failure: { reason: 'locked' as const, message: 'Another push, pull or fetch is running here.' } };
      syncing.add(root);
      // Hold watcher refreshes: a pull rewrites many files, and one refresh at the end is enough.
      const monitor = await monitors.get(root)?.catch(() => null);
      monitor?.hold();
      let sent = 0;
      try {
        return await sync(repo, op, { signal: context.signal, timeoutMs: syncTimeoutMs, onProgress: progress => {
          if (Date.now() - sent < progressEveryMs && progress.percent !== 100) return;
          sent = Date.now();
          void context.experimental_emitSignal('progress', { root, opId, progress });
        } });
      } finally {
        syncing.delete(root);
        monitor?.release();
      }
    },
  },
  dispose: async () => {
    await Promise.all([...monitors.values()].map(async monitor => (await monitor.catch(() => null))?.dispose()));
    monitors.clear();
  },
});
