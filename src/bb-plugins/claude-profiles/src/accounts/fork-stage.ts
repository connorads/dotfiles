import { lstat, mkdir, readdir, readlink, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// BB's Claude bridge forks a session in its own process, which has no account
// CLAUDE_CONFIG_DIR, so the SDK looks only in the default config dir. A link
// there to the source's account project directory lets the bridge find the
// source and write the fork beside it, inside the account the fork launches on.
// The SDK scans project directories in sorted order and '+' sorts before every
// '-' project key, so the account copy wins over a stale default copy.
// Delete this module when the bridge forks with the thread's launch env.
const prefix = '+bb-fork-stage-';
const sessionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// A thread ID becomes one path segment, so it must not contain a separator or a dot.
const threadPattern = /^[a-z0-9_]+$/i;

async function stat(path: string) {
  return lstat(path).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
}
function linkPath(defaultDir: string, forkThreadId: string) {
  if (!threadPattern.test(forkThreadId)) throw new Error('Invalid thread ID.');
  return join(defaultDir, 'projects', `${prefix}${forkThreadId}`);
}

/** Link the account project directory that holds the source session into the default projects. */
export async function stageFork(defaultDir: string, accountDir: string, sessionId: string, forkThreadId: string) {
  if (!sessionPattern.test(sessionId)) throw new Error('Invalid native session ID.');
  const link = linkPath(defaultDir, forkThreadId);
  const projects = join(accountDir, 'projects');
  const matches: string[] = [];
  for (const entry of await readdir(projects, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && (await stat(join(projects, entry.name, `${sessionId}.jsonl`)))?.isFile()) {
      matches.push(join(projects, entry.name));
    }
  }
  const target = matches[0];
  if (!target) throw new Error(`Source session ${sessionId} was not found in this account.`);
  if (matches.length > 1) throw new Error(`Source session ${sessionId} is in ${matches.length} project directories of this account.`);
  await mkdir(join(defaultDir, 'projects'), { recursive: true, mode: 0o700 });
  const existing = await stat(link);
  if (existing) {
    if (existing.isSymbolicLink() && await readlink(link) === target) return { link, target };
    throw new Error(`${link} already exists. It was not replaced.`);
  }
  await symlink(target, link, 'dir');
  return { link, target };
}

/** Remove a fork's link without following it. `forked` says whether the fork landed beside the source. */
export async function unstageFork(defaultDir: string, forkThreadId: string, forkSessionId: string | null) {
  const link = linkPath(defaultDir, forkThreadId);
  if (!(await stat(link))?.isSymbolicLink()) return { removed: false, forked: null };
  const forked = forkSessionId && sessionPattern.test(forkSessionId)
    ? Boolean((await stat(join(await readlink(link), `${forkSessionId}.jsonl`)))?.isFile()) : null;
  await unlink(link);
  return { removed: true, forked };
}

/** Remove stage links older than `maxAgeMs`, such as those left by a crash. */
export async function sweepForkStages(defaultDir: string, maxAgeMs: number) {
  const projects = join(defaultDir, 'projects');
  const removed: string[] = [];
  for (const name of await readdir(projects).catch(() => [])) {
    if (!name.startsWith(prefix)) continue;
    const value = await stat(join(projects, name));
    if (value?.isSymbolicLink() && Date.now() - value.mtimeMs >= maxAgeMs) {
      await unlink(join(projects, name));
      removed.push(name);
    }
  }
  return removed;
}
