import { mkdir, rename, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import { parseStatus } from './porcelain.ts';
import { git, relative, type Repo } from './repo.ts';
import { failed, spawnGit, type OpOptions, type OpResult } from './spawn.ts';

/** The user's Trash: Finder's on macOS, the freedesktop one elsewhere. */
function trashDir(home = homedir()) {
  return platform() === 'darwin' ? join(home, '.Trash') : join(home, '.local', 'share', 'Trash', 'files');
}

/** A name in the Trash that does not overwrite an earlier discard of the same file. */
async function freeName(dir: string, name: string) {
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? name : `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}${attempt > 1 ? ` ${attempt}` : ''}`;
    if (!await stat(join(dir, candidate)).then(() => true, () => false)) return candidate;
  }
}

/**
 * Discards one change, but recoverably. Unstaged edits are first saved as a git
 * blob, named in the summary; untracked paths move to the Trash rather than
 * being deleted. Either way the file's live status is checked first, so a stale
 * row in the pop-up can never discard something that has since changed shape.
 */
export async function discard(repo: Repo, path: string, area: 'unstaged' | 'untracked', options: OpOptions & { trash?: string }): Promise<OpResult> {
  const safe = relative(path);
  const status = parseStatus(await git(repo, ['status', '--porcelain=v2', '-z', '--', safe.replace(/\/$/, '')]));
  const change = status.changes.find(entry => entry.path === safe && entry.area === area);
  if (!change) return { ok: false, failure: { reason: 'unknown', message: `${safe} is no longer ${area === 'untracked' ? 'untracked' : 'changed'}. Nothing was discarded.` } };
  const name = basename(safe.replace(/\/$/, ''));

  if (area === 'untracked') {
    const trash = options.trash ?? trashDir();
    await mkdir(trash, { recursive: true });
    const target = await freeName(trash, name);
    try { await rename(join(repo.cwd, safe), join(trash, target)); }
    catch (cause) { return { ok: false, failure: { reason: 'unknown', message: `Could not move ${safe} to the Trash: ${cause instanceof Error ? cause.message : String(cause)}` } }; }
    return { ok: true, summary: `Moved ${name} to the Trash` };
  }

  // A deleted file has no content to keep; anything else is saved before restoring.
  const blob = change.code === 'D' ? null : (await git(repo, ['hash-object', '-w', '--', safe])).trim();
  const result = await spawnGit(repo, ['restore', '--worktree', '--', safe], options);
  if (result.code !== 0) return failed(result, 'restore', options.timeoutMs);
  return { ok: true, summary: blob ? `Discarded changes to ${name} (kept as blob ${blob.slice(0, 10)})` : `Restored ${name}` };
}
