// Parsers for the NUL-delimited git output the host collects. Formats: git-status(1)
// "Porcelain Format Version 2", git-diff(1) "--numstat -z" and a custom `git log` format.

export type Area = 'conflicted' | 'staged' | 'unstaged' | 'untracked';
export type Code = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | '?';
export interface Change {
  path: string;
  origPath: string | null;
  area: Area;
  code: Code;
  added: number | null;
  removed: number | null;
}
export interface Branch {
  /** Null when HEAD is detached. */
  head: string | null;
  /** Null before the first commit. */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}
export interface Status { branch: Branch; stash: number; changes: Change[] }

const codes = new Set<string>(['A', 'C', 'D', 'M', 'R', 'T']);
const field = (line: string, count: number) => {
  const parts = line.split(' ');
  return { parts, path: parts.slice(count).join(' ') };
};

export function parseStatus(output: string): Status {
  const branch: Branch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const changes: Change[] = [];
  let stash = 0;
  const tokens = output.split('\0');
  const change = (path: string, origPath: string | null, area: Area, code: Code) =>
    changes.push({ path, origPath, area, code, added: null, removed: null });
  for (let index = 0; index < tokens.length; index++) {
    const line = tokens[index]!;
    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') branch.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) { branch.ahead = Number(match[1]); branch.behind = Number(match[2]); }
      } else if (key === 'stash') stash = Number(value) || 0;
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const renamed = line.startsWith('2 ');
      const { parts, path } = field(line, renamed ? 9 : 8);
      const origPath = renamed ? tokens[++index] ?? null : null;
      const [x, y] = parts[1]!;
      if (codes.has(x!)) change(path, origPath, 'staged', x as Code);
      if (codes.has(y!)) change(path, null, 'unstaged', y as Code);
    } else if (line.startsWith('u ')) {
      change(field(line, 10).path, null, 'conflicted', 'U');
    } else if (line.startsWith('? ')) {
      change(line.slice(2), null, 'untracked', '?');
    }
  }
  return { branch, stash, changes };
}

export interface Stat { added: number | null; removed: number | null }

/** `git diff --numstat -z`: binary files report `-` and map to null. */
export function parseNumstat(output: string): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  const tokens = output.split('\0');
  for (let index = 0; index < tokens.length; index++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[index]!);
    if (!match) continue;
    // A rename leaves the path empty and spends the next two tokens on old and new paths.
    const path = match[3] ? match[3] : (index += 2, tokens[index] ?? '');
    const count = (value: string) => value === '-' ? null : Number(value);
    stats.set(path, { added: count(match[1]!), removed: count(match[2]!) });
  }
  return stats;
}

export interface FileChange { path: string; origPath: string | null; code: Exclude<Code, 'U' | '?'> }
/** `git diff --name-status -z`: renames and copies carry a score and both paths. */
export function parseNameStatus(output: string): FileChange[] {
  const tokens = output.split('\0');
  const files: FileChange[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const status = tokens[index]!;
    if (!/^[ACDMRTUX]\d*$/.test(status)) continue;
    const letter = status[0]!;
    const code = (codes.has(letter) ? letter : 'M') as FileChange['code'];
    if (letter === 'R' || letter === 'C') {
      files.push({ origPath: tokens[index + 1] ?? null, path: tokens[index + 2] ?? '', code });
      index += 2;
    } else files.push({ path: tokens[++index] ?? '', origPath: null, code });
  }
  return files;
}

export function withStats(changes: Change[], staged: Map<string, Stat>, unstaged: Map<string, Stat>): Change[] {
  return changes.map(change => {
    const stat = change.area === 'staged' ? staged.get(change.path)
      : change.area === 'unstaged' ? unstaged.get(change.path) : undefined;
    return stat ? { ...change, ...stat } : change;
  });
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag';
export interface Ref { name: string; kind: RefKind }
export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  /** Unix seconds. */
  time: number;
  refs: Ref[];
  subject: string;
}

export const logFormat = '%H%x1f%P%x1f%an%x1f%ct%x1f%D%x1f%s%x1e';

/** Decorations from `--decorate=full`, so ref kinds come from their namespace. */
function parseRefs(decoration: string): Ref[] {
  const refs: Ref[] = [];
  for (let part of decoration.split(', ').filter(Boolean)) {
    let head = false;
    if (part.startsWith('HEAD -> ')) { head = true; part = part.slice(8); }
    if (part === 'HEAD') refs.push({ name: 'HEAD', kind: 'head' });
    else if (part.startsWith('tag: refs/tags/')) refs.push({ name: part.slice(15), kind: 'tag' });
    else if (part.startsWith('refs/heads/')) refs.push({ name: part.slice(11), kind: head ? 'head' : 'local' });
    else if (part.startsWith('refs/remotes/') && !part.endsWith('/HEAD')) refs.push({ name: part.slice(13), kind: 'remote' });
  }
  return refs;
}

export function parseLog(output: string): Commit[] {
  return output.split('\x1e').map(record => record.replace(/^\n/, '')).filter(Boolean).map(record => {
    const [sha, parents, author, time, decoration, ...subject] = record.split('\x1f');
    return { sha: sha!, parents: parents ? parents.split(' ') : [], author: author ?? '', time: Number(time),
      refs: parseRefs(decoration ?? ''), subject: subject.join('\x1f') };
  });
}

export interface Stash { sha: string; index: number; subject: string; time: number }
/** `git stash list --format=%H%x1f%gs%x1f%ct`, newest first, so line n is `stash@{n}`. */
export function parseStashes(output: string): Stash[] {
  return output.split('\n').filter(Boolean).map((line, index) => {
    const [sha = '', subject = '', time] = line.split('\x1f');
    return { sha, index, subject, time: Number(time) || 0 };
  });
}
