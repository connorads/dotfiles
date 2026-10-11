import { execFile } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { Change, CommitDetail, DiffSource, Snapshot } from '../contracts.ts';
import { gitEnv } from './git-env.ts';
import { logFormat, parseLog, parseNameStatus, parseNumstat, parseStatus, withStats } from './porcelain.ts';

export interface Repo {
  kind: 'repo' | 'dotfiles';
  name: string;
  /** Directory git runs in. */
  cwd: string;
  /** Per-worktree state: HEAD, index, in-progress operations. */
  gitDir: string;
  /** Shared state: refs, packed-refs, config. Equals `gitDir` outside linked worktrees. */
  commonDir: string;
  /** Global options that select the repository, before the subcommand. */
  select: string[];
}

const commitLimit = 30;
const changeLimit = 400;
const patchLimit = 512 * 1024;

interface Run { stdout: string; code: number }
export function run(cwd: string, args: string[], okCodes: readonly number[] = [0]): Promise<Run> {
  return new Promise((resolve, reject) => {
    // GIT_OPTIONAL_LOCKS=0: reads never take index.lock, so polling cannot block an agent's commit.
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10_000,
      env: gitEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }) }, (error, stdout, stderr) => {
      const code = error ? typeof error.code === 'number' ? error.code : -1 : 0;
      if (okCodes.includes(code)) resolve({ stdout, code });
      else reject(new Error(stderr.trim() || error?.message || `git ${args[0]} failed`));
    });
  });
}
export const git = (repo: Repo, args: string[], okCodes?: readonly number[]) =>
  run(repo.cwd, [...repo.select, ...args], okCodes).then(result => result.stdout);

/**
 * The checkout's repository, or the bare dotfiles repository when the checkout is
 * the home directory and no repository encloses it (see the `lgdf` shell function).
 */
export async function resolveRepo(root: string, home = homedir()): Promise<Repo | null> {
  try {
    const [top, gitDir, commonDir] = (await run(root,
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])).stdout.trim().split('\n');
    if (top && gitDir && commonDir) return { kind: 'repo', name: basename(top), cwd: top, gitDir, commonDir, select: [] };
  } catch { /* not inside a work tree */ }
  const dotfiles = join(home, 'git', 'dotfiles');
  if (root !== home || !await access(join(dotfiles, 'HEAD')).then(() => true, () => false)) return null;
  return { kind: 'dotfiles', name: 'dotfiles', cwd: home, gitDir: dotfiles, commonDir: dotfiles, select: [`--git-dir=${dotfiles}`, `--work-tree=${home}`] };
}

const operations = [
  ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['BISECT_LOG', 'bisect'],
] as const;
async function operation(gitDir: string) {
  for (const [file, name] of operations) {
    if (await access(join(gitDir, file)).then(() => true, () => false)) return name;
  }
  return null;
}

const order: Record<Change['area'], number> = { conflicted: 0, staged: 1, unstaged: 2, untracked: 3 };

export async function snapshot(repo: Repo): Promise<Snapshot> {
  const [statusText, staged, unstaged, remotes, op, fetchedAt] = await Promise.all([
    git(repo, ['status', '--porcelain=v2', '--branch', '--show-stash', '-z']),
    git(repo, ['diff', '--cached', '--numstat', '-z']),
    git(repo, ['diff', '--numstat', '-z']),
    git(repo, ['remote']),
    operation(repo.gitDir),
    stat(join(repo.gitDir, 'FETCH_HEAD')).then(info => info.mtimeMs, () => null),
  ]);
  const status = parseStatus(statusText);
  const born = status.branch.oid !== null;
  const [logText, unpushedText] = born ? await Promise.all([
    git(repo, ['log', `-n${commitLimit}`, '--topo-order', '--decorate=full', `--format=${logFormat}`, 'HEAD']),
    remotes.trim() ? git(repo, ['rev-list', `-n${commitLimit}`, 'HEAD', '--not', '--remotes']) : Promise.resolve(''),
  ]) : ['', ''];
  const unpushed = new Set(unpushedText.split('\n').filter(Boolean));
  const changes = withStats(status.changes, parseNumstat(staged), parseNumstat(unstaged))
    .sort((a, b) => order[a.area] - order[b.area] || a.path.localeCompare(b.path));
  return {
    kind: repo.kind, name: repo.name, branch: status.branch, operation: op, stash: status.stash, fetchedAt,
    remotes: remotes.split('\n').filter(Boolean),
    changes: changes.slice(0, changeLimit), hidden: Math.max(0, changes.length - changeLimit),
    commits: parseLog(logText).map(commit => ({ ...commit, unpushed: unpushed.has(commit.sha) })),
  };
}

function relative(path: string) {
  if (!path || isAbsolute(path) || path.split('/').includes('..')) throw new Error(`Refusing path outside the repository: ${path}`);
  return path;
}

const commitFileLimit = 300;

/** The commit's first parent, or the empty tree for a root commit. */
async function base(repo: Repo, sha: string) {
  const parent = (await git(repo, ['rev-parse', '--verify', '-q', `${sha}^1`], [0, 1])).trim();
  return parent || (await run(repo.cwd, [...repo.select, 'hash-object', '-t', 'tree', '/dev/null'])).stdout.trim();
}

export async function diff(repo: Repo, input: { path: string; origPath: string | null; source: DiffSource }) {
  const path = relative(input.path);
  // Untracked directories are listed collapsed; git has no single patch for one.
  if (path.endsWith('/')) return { patch: '', truncated: false };
  const paths = input.origPath ? [relative(input.origPath), path] : [path];
  const flags = ['diff', '--no-color', '--no-ext-diff', '-M'];
  const { source } = input;
  const patch = source.kind === 'commit'
    ? await git(repo, [...flags, await base(repo, source.sha), source.sha, '--', ...paths])
    : source.area === 'untracked'
      // --no-index exits 1 when the sides differ, which they always do here.
      ? (await run(repo.cwd, [...repo.select, 'diff', '--no-color', '--no-index', '--', '/dev/null', path], [0, 1])).stdout
      : await git(repo, [...flags, ...(source.area === 'staged' ? ['--cached'] : []), '--', ...paths]);
  if (patch.length <= patchLimit) return { patch, truncated: false };
  return { patch: patch.slice(0, patch.lastIndexOf('\n', patchLimit) + 1), truncated: true };
}

/** One commit's message, people and files, compared with its first parent. */
export async function commitDetail(repo: Repo, sha: string): Promise<CommitDetail> {
  const format = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s%x1f%b';
  const [header, from] = await Promise.all([git(repo, ['show', '-s', `--format=${format}`, sha, '--']), base(repo, sha)]);
  const [full, parents, author, authorEmail, authoredAt, committer, committedAt, subject, ...body] = header.split('\x1f');
  const range = [from, full!];
  const [names, stats] = await Promise.all([
    git(repo, ['diff', '--name-status', '-z', '-M', ...range]),
    git(repo, ['diff', '--numstat', '-z', '-M', ...range]),
  ]);
  const counts = parseNumstat(stats);
  const files = parseNameStatus(names).map(file => ({ ...file, added: counts.get(file.path)?.added ?? null, removed: counts.get(file.path)?.removed ?? null }));
  return {
    sha: full!, parents: parents ? parents.split(' ') : [], subject: subject ?? '', body: body.join('\x1f').trim(),
    author: author ?? '', authorEmail: authorEmail ?? '', authoredAt: Number(authoredAt), committer: committer ?? '', committedAt: Number(committedAt),
    files: files.slice(0, commitFileLimit), hidden: Math.max(0, files.length - commitFileLimit),
  };
}

/**
 * Paths git ignores, from `check-ignore -v -n`: a match on a `!` pattern re-includes.
 * Tracked files never count as ignored, because check-ignore consults the index.
 */
export async function ignoredAmong(repo: Repo, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile('git', [...repo.select, 'check-ignore', '--stdin', '-z', '-v', '-n'], { cwd: repo.cwd, encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024, timeout: 10_000, env: gitEnv({ GIT_OPTIONAL_LOCKS: '0' }) }, (error, stdout, stderr) => {
      // Exit 1 means nothing matched; anything else (a path past a symlink) fails the batch.
      if (error && error.code !== 1) reject(new Error(stderr.trim() || error.message)); else resolve(stdout);
    });
    child.stdin?.end(paths.join('\0') + '\0');
  });
  const fields = output.split('\0');
  const ignored = new Set<string>();
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source, , pattern, path] = fields.slice(index, index + 4);
    if (source && !pattern!.startsWith('!')) ignored.add(path!);
  }
  return ignored;
}

/**
 * Top-level work-tree entries git ignores, so the watcher can skip their subtrees.
 * Symlinks are skipped: check-ignore rejects paths beyond one, and FSEvents does
 * not follow them anyway.
 */
export async function ignoredTopLevel(repo: Repo): Promise<string[]> {
  const entries = (await readdir(repo.cwd, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink() && entry.name !== '.git');
  const query = entries.map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name);
  const ignored = await ignoredAmong(repo, query);
  return query.filter(path => ignored.has(path)).map(path => path.replace(/\/$/, ''));
}
