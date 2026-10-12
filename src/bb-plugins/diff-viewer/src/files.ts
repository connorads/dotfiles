// Pure: which files appear, in what order, and which patches the first load reads.
import type { StatEntry } from './stat.ts';

const lockfileNames = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'pdm.lock', 'composer.lock',
  'flake.lock', 'go.sum', 'mix.lock', 'Podfile.lock', 'Package.resolved', 'packages.lock.json',
  'gradle.lockfile', 'pubspec.lock', 'deno.lock', 'mise.lock', 'aube-lock.yaml',
]);

/** Generated dependency pins: long, machine-written, rarely worth reading line by line. */
export function isLockfile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return lockfileNames.has(name) || name.endsWith('.lock') || /[.-]lock\.(json|ya?ml)$/.test(name);
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * File-tree order: within a directory, subdirectories before files, then
 * natural name order. Lockfiles go last, so reading starts with real code.
 */
export function compareFiles(a: { path: string }, b: { path: string }): number {
  const lockA = isLockfile(a.path), lockB = isLockfile(b.path);
  if (lockA !== lockB) return lockA ? 1 : -1;
  const partsA = a.path.split('/'), partsB = b.path.split('/');
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const dirA = i < partsA.length - 1, dirB = i < partsB.length - 1;
    if (partsA[i] === partsB[i] && dirA && dirB) continue;
    if (dirA !== dirB) return dirA ? -1 : 1;
    const order = collator.compare(partsA[i]!, partsB[i]!);
    if (order !== 0) return order;
  }
  return partsA.length - partsB.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Why a file's patch is not in the first load; the panel fetches it on demand. */
export type Deferral = 'lockfile' | 'large' | 'budget';
export type LoadDecision = { kind: 'inline' } | { kind: 'binary' } | { kind: 'deferred'; reason: Deferral };

export interface LoadBudget {
  /** One file's changed lines past which its patch waits for a click. */
  largeLines: number;
  /** An untracked file's size past which it waits for a click. */
  largeBytes: number;
  /** Changed lines read in the first load across all tracked files. */
  totalLines: number;
  /** Untracked files whose patches the first load reads; each costs one git run. */
  untrackedFiles: number;
}

export const loadBudget: LoadBudget = { largeLines: 5_000, largeBytes: 512 * 1024, totalLines: 40_000, untrackedFiles: 100 };

/**
 * Decide per file, in display order, whether the first load reads its patch.
 * `sizes` holds untracked file sizes in bytes.
 */
export function planLoad(entries: readonly StatEntry[], sizes: ReadonlyMap<string, number>, budget = loadBudget): LoadDecision[] {
  let lines = 0, untracked = 0;
  return entries.map((entry): LoadDecision => {
    if (entry.binary) return { kind: 'binary' };
    if (isLockfile(entry.path)) return { kind: 'deferred', reason: 'lockfile' };
    if (entry.untracked) {
      if ((sizes.get(entry.path) ?? 0) > budget.largeBytes) return { kind: 'deferred', reason: 'large' };
      if (++untracked > budget.untrackedFiles) return { kind: 'deferred', reason: 'budget' };
      return { kind: 'inline' };
    }
    const changed = (entry.additions ?? 0) + (entry.deletions ?? 0);
    if (changed > budget.largeLines) return { kind: 'deferred', reason: 'large' };
    if (lines + changed > budget.totalLines) return { kind: 'deferred', reason: 'budget' };
    lines += changed;
    return { kind: 'inline' };
  });
}
