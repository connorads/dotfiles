// Pure helpers for the panel: defaults, labels and file-to-file navigation.
import type { FileDiff } from '../contracts.ts';

/** Lockfiles and deletions start collapsed: their lines are rarely worth reading. */
export const defaultCollapsed = (file: Pick<FileDiff, 'lockfile' | 'status'>) => file.lockfile || file.status === 'deleted';

export const statusLetter: Record<FileDiff['status'], string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' };

export function totals(files: readonly Pick<FileDiff, 'additions' | 'deletions'>[]): { additions: number; deletions: number } {
  return files.reduce<{ additions: number; deletions: number }>((sum, file) => ({ additions: sum.additions + (file.additions ?? 0), deletions: sum.deletions + (file.deletions ?? 0) }),
    { additions: 0, deletions: 0 });
}

export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  return { dir: slash < 0 ? '' : path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

/** The file at the top of the view: the last one whose top is at or above the scroll position. */
export function currentFile(tops: readonly number[], scrollTop: number, slack = 4): number {
  let current = -1;
  for (let i = 0; i < tops.length; i++) if (tops[i]! <= scrollTop + slack) current = i;
  return current;
}

/**
 * The file to jump to from the scroll position. `tops` are the files' offsets
 * in the scroll container, ascending. Back from inside a file goes to that
 * file's top first, as `[[` does in vim.
 */
export function neighbour(tops: readonly number[], scrollTop: number, direction: 1 | -1, slack = 4): number | null {
  if (tops.length === 0) return null;
  const current = currentFile(tops, scrollTop, slack);
  if (direction === 1) return Math.min(current + 1, tops.length - 1);
  if (current < 0) return null;
  return scrollTop > tops[current]! + slack ? current : Math.max(current - 1, 0);
}

export function age(seconds: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs / 1000 - seconds) / 60));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 60 / 24)}d`;
}
