import { access, realpath, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { git, resolveRepo, type Repo } from './repo.ts';

function isOutside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '..' || rel.startsWith('../') || isAbsolute(rel);
}

async function resolveHome(home: string) {
  return realpath(home).catch(() => resolve(home));
}

function expandPath(root: string, path: string, home: string) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return resolve(root, path);
}

async function worktrees(repo: Repo) {
  const output = await git(repo, ['worktree', 'list', '--porcelain', '-z']);
  return output.split('\0\0').flatMap(record => {
    const fields = record.split('\0');
    const path = fields.find(field => field.startsWith('worktree '))?.slice(9);
    if (!path || fields.includes('bare') || fields.some(field => field === 'prunable' || field.startsWith('prunable '))) return [];
    const branch = fields.find(field => field.startsWith('branch refs/heads/'))?.slice(18) ?? null;
    return [{ path, branch }];
  });
}

async function folder(base: string, path: string, home = homedir()) {
  const [root, homeDir] = await Promise.all([realpath(base), resolveHome(home)]);
  const raw = expandPath(root, path, homeDir);
  let target: string;
  try {
    target = await realpath(raw);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') throw new Error(`Folder not found: ${path}`);
    if (code === 'EACCES' || code === 'EPERM') throw new Error(`Permission denied: ${path}`);
    throw cause;
  }
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error(`Not a folder: ${path}`);
  const rel = relative(root, target);
  return { root, target, home: homeDir, path: isOutside(root, target) ? target : (rel || '.') };
}

export async function resolveCheckout(path: string, home = homedir()) {
  if (!isAbsolute(path)) throw new Error('Use an absolute checkout path.');
  const [root, homeDir] = await Promise.all([realpath(path), resolveHome(home)]);
  const repo = await resolveRepo(root, homeDir);
  if (!repo || repo.cwd !== root) throw new Error('The path is not a Git checkout root.');
  return root;
}

export async function selectFolder(base: string, path: string, worktree?: string, home = homedir()) {
  const { target, home: homeDir } = await folder(base, path, home);
  const repo = await resolveRepo(target, homeDir);
  if (!repo) throw new Error('Folder is not a git repository.');
  if (worktree !== undefined) {
    if (!(await worktrees(repo)).some(tree => tree.path === worktree)) throw new Error('Choose a registered worktree of this repository.');
    const targetRepo = await resolveRepo(worktree, homeDir);
    if (!targetRepo || await realpath(targetRepo.commonDir) !== await realpath(repo.commonDir)) {
      throw new Error('The registered worktree is missing or belongs to another repository.');
    }
    return targetRepo.cwd;
  }
  return repo.cwd;
}

const hasDotfilesHead = (homeDir: string) =>
  access(join(homeDir, 'git', 'dotfiles', 'HEAD')).then(() => true, () => false);

export async function browseFolders(base: string, path: string, home = homedir()) {
  const { root, target, home: homeDir, path: rel } = await folder(base, path, home);
  let rawEntries;
  try {
    rawEntries = await readdir(target, { withFileTypes: true });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    if (code === 'EACCES' || code === 'EPERM') throw new Error(`Permission denied: ${target}`);
    throw cause;
  }
  const entries = rawEntries
    .filter(entry => entry.isDirectory() && entry.name !== '.git')
    .sort((a, b) => a.name.localeCompare(b.name));
  const folders: { name: string; repository: boolean }[] = [];
  // Check only this level; never traverse dependency trees or the whole home.
  for (const entry of entries) {
    const child = join(target, entry.name);
    const hasGit = await access(join(child, '.git')).then(() => true, () => false);
    const repo = hasGit || child === homeDir ? await resolveRepo(child, homeDir) : null;
    const repository = repo?.cwd === child;
    // Dot-folders are tool state unless they are a repository, such as `.github`.
    if (repository || !entry.name.startsWith('.')) folders.push({ name: entry.name, repository });
  }
  const repo = await resolveRepo(target, homeDir);
  const isTargetRepo = repo?.cwd === target;
  const dotfiles = target === homeDir
    ? repo?.kind === 'dotfiles'
    : (await hasDotfilesHead(homeDir)) && (await resolveRepo(homeDir, homeDir))?.kind === 'dotfiles';
  const parentDir = dirname(target);
  return {
    root: target,
    base: root,
    home: homeDir,
    parent: parentDir !== target ? parentDir : null,
    dotfiles,
    path: rel,
    repository: isTargetRepo,
    repoKind: isTargetRepo ? repo.kind : null,
    folders,
    worktrees: isTargetRepo && repo.kind === 'repo' ? await worktrees(repo) : [],
  };
}

const SKIPPED = new Set(['node_modules', 'Library']);
const isRepository = (path: string) => access(join(path, '.git')).then(() => true, () => false);

/** Subfolders of `rel` under `root`, sorted, as paths relative to `root`. */
async function subfolders(root: string, rel: string) {
  const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
  return entries
    .filter(entry => entry.isDirectory() && entry.name !== '.git' && !SKIPPED.has(entry.name))
    .map(entry => ({ path: rel ? `${rel}/${entry.name}` : entry.name, hidden: entry.name.startsWith('.') }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Lists repository roots below a folder, relative to it. The walk is breadth first and
 * never enters a repository, hidden folder or symlink; a hidden repository still counts.
 * Deep walks stay within the thread checkout or Home so browsing `/` or `/Users` never crawls the system.
 */
export async function findRepositories(base: string, path: string, { depth = 4, limit = 1000, folders = 50_000, home = homedir() } = {}) {
  const { root, target, home: homeDir } = await folder(base, path, home);
  if (isOutside(root, target) && isOutside(homeDir, target)) {
    return { repositories: [], truncated: false, skipped: true };
  }
  const repositories: string[] = [];
  let visited = 0;
  let level = [''];
  for (let at = 1; level.length; at++) {
    const next: string[] = [];
    for (const parent of level) {
      if (++visited > folders) return { repositories: repositories.sort(), truncated: true };
      for (const { path: rel, hidden } of await subfolders(target, parent)) {
        const repository = await isRepository(join(target, rel));
        if (!repository && !hidden && at < depth) next.push(rel);
        if (repository && repositories.push(rel) >= limit) return { repositories: repositories.sort(), truncated: true };
      }
    }
    level = next;
  }
  return { repositories: repositories.sort(), truncated: false };
}
