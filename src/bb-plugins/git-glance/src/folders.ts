import { access, realpath, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { resolveRepo } from './repo.ts';

async function folder(base: string, path: string) {
  const root = await realpath(base);
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Folder is outside the thread checkout.');
  return { root, target, path: rel || '.' };
}

export async function selectFolder(base: string, path: string) {
  const { root, target } = await folder(base, path);
  const repo = await resolveRepo(target);
  if (!repo) throw new Error('Folder is not a git repository.');
  // An enclosing repository can sit above a thread's checkout; selecting it must
  // not widen the folder browser's boundary.
  const rel = relative(root, repo.cwd);
  return rel === '..' || rel.startsWith('../') || isAbsolute(rel) ? target : repo.cwd;
}

export async function browseFolders(base: string, path: string) {
  const { target, path: rel } = await folder(base, path);
  const entries = (await readdir(target, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== '.git')
    .sort((a, b) => a.name.localeCompare(b.name));
  const folders: { name: string; repository: boolean }[] = [];
  // Check only this level; never traverse dependency trees or the whole home.
  for (const entry of entries) {
    const child = join(target, entry.name);
    const hasGit = await access(join(child, '.git')).then(() => true, () => false);
    const repo = hasGit ? await resolveRepo(child) : null;
    folders.push({ name: entry.name, repository: repo?.cwd === child });
  }
  const repo = await resolveRepo(target);
  return { root: target, path: rel, repository: repo?.cwd === target, folders };
}
