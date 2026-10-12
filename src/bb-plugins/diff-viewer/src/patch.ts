// Pure parsing of `git diff` output: one record per file, ready for BB's
// single-file diff component.

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface ParsedFile {
  /** Path after the change; the old path for a deletion. */
  path: string;
  /** Source path of a rename or copy; null otherwise. */
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  /** `100644 → 100755` when only or also the mode changed. */
  modeChange: string | null;
  additions: number;
  deletions: number;
  /** Number of `@@` hunks; zero for a pure rename, a mode change or a binary file. */
  hunks: number;
  /** This file's whole section of the diff, from its `diff --git` line. */
  patch: string;
}

const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Undo git's C-style path quoting (`"tab\there"`, octal UTF-8 bytes such as
 * `"r\303\251sum\303\251"`). An unquoted path is returned as is.
 */
export function unquotePath(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const body = raw.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    if (body[i] !== '\\') {
      const char = String.fromCodePoint(body.codePointAt(i)!);
      bytes.push(...encoder.encode(char));
      i += char.length;
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      i += 2;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `a/x` or `"a/x"` to `x`; `/dev/null` to null. */
function sidePath(raw: string, prefix: 'a/' | 'b/'): string | null {
  const trimmed = raw.replace(/\t$/, '');
  if (trimmed === '/dev/null') return null;
  const path = unquotePath(trimmed);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Paths from `diff --git a/X b/Y` when no `---`/`+++` or rename line names
 * them (binary and mode-only changes). Without a rename both sides are equal,
 * which settles where an unquoted header with spaces splits.
 */
function headerPaths(rest: string): { a: string; b: string } | null {
  if (rest.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*") (.+)$/.exec(rest);
    if (!match) return null;
    return { a: sidePath(match[1]!, 'a/') ?? '', b: sidePath(match[2]!, 'b/') ?? '' };
  }
  if (rest.endsWith('"')) {
    const match = /^(.+?) ("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (!match) return null;
    return { a: sidePath(match[1]!, 'a/') ?? '', b: sidePath(match[2]!, 'b/') ?? '' };
  }
  if ((rest.length - 1) % 2 === 0) {
    const half = (rest.length - 1) / 2;
    const a = rest.slice(0, half), b = rest.slice(half + 1);
    if (a.startsWith('a/') && b.startsWith('b/') && a.slice(2) === b.slice(2)) return { a: a.slice(2), b: b.slice(2) };
  }
  const split = rest.indexOf(' b/');
  return split < 0 ? null : { a: rest.slice(0, split).replace(/^a\//, ''), b: rest.slice(split + 3) };
}

function parseOne(patch: string): ParsedFile {
  const lines = patch.split('\n');
  let oldPath: string | null | undefined, newPath: string | null | undefined;
  let renameFrom: string | null = null, renameTo: string | null = null, copied = false;
  let created = false, deleted = false, binary = false;
  let oldMode: string | null = null, newMode: string | null = null;
  let additions = 0, deletions = 0, hunks = 0, inHunk = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('@@')) { hunks++; inHunk = true; continue; }
    if (inHunk) {
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
      continue;
    }
    if (line.startsWith('--- ')) oldPath = sidePath(line.slice(4), 'a/');
    else if (line.startsWith('+++ ')) newPath = sidePath(line.slice(4), 'b/');
    else if (line.startsWith('rename from ')) renameFrom = unquotePath(line.slice(12));
    else if (line.startsWith('rename to ')) renameTo = unquotePath(line.slice(10));
    else if (line.startsWith('copy from ')) { renameFrom = unquotePath(line.slice(10)); copied = true; }
    else if (line.startsWith('copy to ')) { renameTo = unquotePath(line.slice(8)); copied = true; }
    else if (line.startsWith('new file mode ')) { created = true; newMode = line.slice(14); }
    else if (line.startsWith('deleted file mode ')) { deleted = true; oldMode = line.slice(18); }
    else if (line.startsWith('old mode ')) oldMode = line.slice(9);
    else if (line.startsWith('new mode ')) newMode = line.slice(9);
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true;
  }
  const header = headerPaths(lines[0]!.slice('diff --git '.length));
  const before = renameFrom ?? oldPath ?? header?.a ?? '';
  const after = renameTo ?? newPath ?? header?.b ?? before;
  const status: FileStatus = created ? 'added' : deleted ? 'deleted'
    : renameFrom !== null && renameTo !== null ? copied ? 'copied' : 'renamed' : 'modified';
  return {
    path: status === 'deleted' ? (oldPath ?? before) : after,
    oldPath: status === 'renamed' || status === 'copied' ? before : null,
    status, binary,
    modeChange: oldMode && newMode && !created && !deleted && oldMode !== newMode ? `${oldMode} → ${newMode}` : null,
    additions, deletions, hunks, patch,
  };
}

/** Split a multi-file `git diff` (with `a/` and `b/` prefixes) into one record per file. */
export function parsePatch(diff: string): ParsedFile[] {
  const starts = [...diff.matchAll(/^diff --git /gm)].map(match => match.index);
  return starts.map((start, i) => parseOne(diff.slice(start, starts[i + 1] ?? diff.length)));
}
