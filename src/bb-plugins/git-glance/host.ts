import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract, hostSignals, type OpRequest } from './contracts.ts';
import { browseFolders, selectFolder } from './src/folders.ts';
import { createMonitor, type Monitor } from './src/monitor.ts';
import { commitDetail, diff, resolveRepo, type Repo } from './src/repo.ts';
import { listBranches, switchBranch } from './src/branches.ts';
import { discard } from './src/discard.ts';
import { stashAction } from './src/stashes.ts';
import type { OpOptions, OpResult } from './src/spawn.ts';
import { sync } from './src/sync.ts';

const monitors = new Map<string, Promise<Monitor | null>>();
const syncing = new Set<string>();
async function required(root: string): Promise<Repo> {
  const repo = await resolveRepo(root);
  if (!repo) throw new Error(`${root} is not a git repository.`);
  return repo;
}
const remoteTimeoutMs = 3 * 60_000;
const localTimeoutMs = 60_000;
const progressEveryMs = 150;

function perform(repo: Repo, request: OpRequest, options: OpOptions): Promise<OpResult> {
  switch (request.kind) {
    case 'fetch': case 'pull': case 'push': return sync(repo, request.kind, options);
    case 'switch': return switchBranch(repo, request.branch, request.track, options);
    case 'stash-apply': return stashAction(repo, 'apply', request.sha, options);
    case 'stash-pop': return stashAction(repo, 'pop', request.sha, options);
    case 'stash-drop': return stashAction(repo, 'drop', request.sha, options);
    case 'discard': return discard(repo, request.path, request.area, options);
  }
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    folders: ({ root, path }) => browseFolders(root, path),
    select: async ({ root, path }) => ({ root: await selectFolder(root, path) }),
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
    branches: async ({ root }) => listBranches(await required(root)),
    run: async ({ root, request, opId }, context) => {
      const repo = await resolveRepo(root);
      if (!repo) return { ok: false as const, failure: { reason: 'unknown' as const, message: `${root} is not a git repository.` } };
      if (syncing.has(root)) return { ok: false as const, failure: { reason: 'locked' as const, message: 'Another operation is running here.' } };
      syncing.add(root);
      // Hold watcher refreshes: a pull or switch rewrites many files; one refresh at the end is enough.
      const monitor = await monitors.get(root)?.catch(() => null);
      monitor?.hold();
      let sent = 0;
      try {
        const remote = request.kind === 'fetch' || request.kind === 'pull' || request.kind === 'push';
        return await perform(repo, request, { signal: context.signal, timeoutMs: remote ? remoteTimeoutMs : localTimeoutMs, onProgress: progress => {
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
