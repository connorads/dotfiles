// Pure parsers for `git diff --name-status -z` and `--numstat -z`, joined into
// one entry per changed file before any patch is read.
import type { FileStatus } from './patch.ts';

export interface StatEntry {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  /** Null for a binary file, or for an untracked file before its patch is read. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  untracked: boolean;
}

const statusByCode: Record<string, FileStatus> = { A: 'added', D: 'deleted', R: 'renamed', C: 'copied' };

/** `M\0path\0`, `R100\0old\0new\0`, `C75\0old\0new\0`. */
export function parseNameStatus(text: string): { path: string; oldPath: string | null; status: FileStatus }[] {
  const fields = text.split('\0');
  const entries: { path: string; oldPath: string | null; status: FileStatus }[] = [];
  for (let i = 0; i + 1 < fields.length; i++) {
    const code = fields[i]!.charAt(0);
    if (!code) continue;
    const status = statusByCode[code] ?? 'modified';
    if (code === 'R' || code === 'C') {
      entries.push({ oldPath: fields[i + 1]!, path: fields[i + 2] ?? '', status });
      i += 2;
    } else {
      entries.push({ path: fields[i + 1]!, oldPath: null, status });
      i += 1;
    }
  }
  return entries;
}

/** `added\tdeleted\tpath\0`, or `added\tdeleted\t\0old\0new\0` for a rename; `-` counts mean binary. */
export function parseNumstat(text: string): Map<string, { additions: number | null; deletions: number | null }> {
  const fields = text.split('\0');
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < fields.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[i]!);
    if (!match) continue;
    let path = match[3]!;
    if (path === '') { path = fields[i + 2] ?? ''; i += 2; }
    counts.set(path, {
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
    });
  }
  return counts;
}

/**
 * One entry per tracked change, with its line counts. Without an index
 * refresh, `--name-status` also lists files whose stat data changed but whose
 * content did not; `--numstat` compares content and omits them, so they drop.
 */
export function joinStats(nameStatus: string, numstat: string): StatEntry[] {
  const counts = parseNumstat(numstat);
  return parseNameStatus(nameStatus).flatMap((entry): StatEntry[] => {
    const count = counts.get(entry.path);
    if (!count) return [];
    return count.additions === null
      ? [{ ...entry, additions: null, deletions: null, binary: true, untracked: false }]
      : [{ ...entry, additions: count.additions, deletions: count.deletions ?? 0, binary: false, untracked: false }];
  });
}

/** Paths from `git ls-files --others -z`; nested repositories appear as `dir/` and have no patch. */
export function parseUntracked(text: string): StatEntry[] {
  return text.split('\0').filter(path => path && !path.endsWith('/'))
    .map(path => ({ path, oldPath: null, status: 'added' as const, additions: null, deletions: null, binary: false, untracked: true }));
}

/** Fields before the path in each `git status --porcelain=v2 -z` record type. */
const statusFields: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 };

/** Paths from `git status --porcelain=v2 -z`; a rename's source record follows it and is skipped. */
export function parseStatusPaths(text: string): string[] {
  const records = text.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const fields = statusFields[record.charAt(0)];
    if (fields === undefined || record.charAt(1) !== ' ') continue;
    paths.push(record.split(' ').slice(fields).join(' '));
    if (record.charAt(0) === '2') i++;
  }
  return paths;
}
