import type { Snapshot } from '../contracts.ts';
import { ignoredAmong, ignoredTopLevel, snapshot, type Repo } from './repo.ts';
import { singleFlight } from './single-flight.ts';
import { gitDirIgnores, gitDirRelevant, within } from './watch-filter.ts';

/** The host's native watcher: `experimental_watch` from the host RPC context. */
export type WatchEvent =
  | { kind: 'changed'; changes: readonly { path: string }[] }
  | { kind: 'rescan-required' }
  | { kind: 'watch-error'; message: string };
export type Watch = (options: { rootPath: string; ignoredPaths?: readonly string[]; debounceMs?: number; maxWaitMs?: number },
  listener: (event: WatchEvent) => void | Promise<void>) => Promise<{ dispose(): Promise<void> }>;

export interface Monitor {
  /** The latest snapshot, computed before `createMonitor` resolves. */
  current(): Snapshot;
  /** Defer refreshes while a git command of ours runs; `release` refreshes once. */
  hold(): void;
  release(): void;
  dispose(): Promise<void>;
}

/** Batches beyond this many work-tree paths refresh without asking check-ignore. */
const filterLimit = 2000;
/** A failed watch falls back to polling at this interval until disposed. */
const pollMs = 15_000;
/** The native watcher resolves only once ready; never block the creating call on it. */
const readyTimeoutMs = 5_000;

/**
 * Watches one repository and publishes a snapshot whenever what it shows changes.
 * The work tree and git dir are separate watches: the git dir may live outside the
 * work tree (bare dotfiles, linked worktrees), and inside it only a few files matter.
 */
export async function createMonitor(repo: Repo, deps: { watch: Watch; publish(snapshot: Snapshot): void; log(message: string): void }): Promise<Monitor> {
  let latest = await snapshot(repo);
  let published = JSON.stringify(latest);
  let disposed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  const flight = singleFlight(async () => {
    if (disposed) return;
    const next = await snapshot(repo);
    const text = JSON.stringify(next);
    latest = next;
    if (text === published || disposed) return;
    published = text;
    deps.publish(next);
  });

  async function workTreeChanged(paths: string[]) {
    const relative = paths.flatMap(path => {
      const rel = within(repo.cwd, path);
      return rel && within(repo.gitDir, path) === null && within(repo.commonDir, path) === null ? [rel] : [];
    });
    if (relative.length === 0) return;
    if (relative.length > filterLimit) { flight.trigger(); return; }
    try {
      const ignored = await ignoredAmong(repo, relative);
      if (relative.some(path => !ignored.has(path))) flight.trigger();
    } catch { flight.trigger(); }
  }
  type Scope = { kind: 'work-tree' } | { kind: 'git-dir'; dir: string };
  function onEvent(scope: Scope) {
    return async (event: WatchEvent) => {
      if (event.kind === 'watch-error') {
        deps.log(`Watching ${scope.kind === 'git-dir' ? scope.dir : repo.cwd} failed (${event.message}); polling every ${pollMs / 1000}s.`);
        poll ??= setInterval(() => flight.trigger(), pollMs);
        flight.trigger();
      } else if (event.kind === 'rescan-required') flight.trigger();
      else if (scope.kind === 'work-tree') await workTreeChanged(event.changes.map(change => change.path));
      else if (event.changes.some(change => gitDirRelevant(within(scope.dir, change.path) ?? ''))) flight.trigger();
    };
  }

  const withTimeout = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), readyTimeoutMs))]);
  const gitDirs = [...new Set([repo.gitDir, repo.commonDir])];
  const subscriptions = gitDirs.map(dir => deps.watch({ rootPath: dir, ignoredPaths: gitDirIgnores }, onEvent({ kind: 'git-dir', dir })));
  const workIgnores = await ignoredTopLevel(repo).catch(() => []);
  subscriptions.push(deps.watch({ rootPath: repo.cwd, ignoredPaths: ['.git', ...workIgnores], debounceMs: 150, maxWaitMs: 1000 }, onEvent({ kind: 'work-tree' })));
  await Promise.all(subscriptions.map(subscription => withTimeout(subscription).catch((error: unknown) => {
    deps.log(`Could not watch ${repo.cwd}: ${error instanceof Error ? error.message : String(error)}`);
    poll ??= setInterval(() => flight.trigger(), pollMs);
  })));

  return {
    current: () => latest,
    hold: () => flight.hold(),
    release: () => flight.release(),
    async dispose() {
      disposed = true;
      if (poll) clearInterval(poll);
      await Promise.all(subscriptions.map(subscription => subscription.then(s => s.dispose(), () => {})));
    },
  };
}
