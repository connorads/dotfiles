// Pure: what each scope compares, and the git argv that reads it.
import type { Commit, Spec } from '../contracts.ts';

/**
 * Options before every subcommand. `diff.autoRefreshIndex=false` stops a
 * work-tree `git diff` rewriting the index to refresh stat data, which it does
 * even with `GIT_OPTIONAL_LOCKS=0`; the stat-only changes it then lists in
 * `--name-status` are dropped by `joinStats`.
 */
export const globalFlags = ['-c', 'core.quotePath=false', '-c', 'diff.autoRefreshIndex=false', '--literal-pathspecs'];

/** Diff output in the one shape the parser expects, whatever `diff.*` config says. */
export const diffFlags = ['--no-color', '--no-ext-diff', '--no-relative', '--submodule=short', '-M', '--src-prefix=a/', '--dst-prefix=b/'];

/** `from` against `to`, or against the work tree when `to` is null. */
const sides = (spec: Spec) => spec.to ? [spec.from, spec.to] : [spec.from];

export function patchArgv(spec: Spec, paths: readonly string[]): string[] {
  return ['diff', ...diffFlags, ...sides(spec), '--', ...paths];
}

export function statArgv(spec: Spec, format: '--numstat' | '--name-status'): string[] {
  return ['diff', format, '-z', '-M', '--no-ext-diff', '--no-relative', ...sides(spec), '--'];
}

/** An untracked file as a new-file patch. Exits 1 because the sides differ. */
export function untrackedArgv(path: string): string[] {
  return ['diff', ...diffFlags, '--no-index', '--', '/dev/null', path];
}

export const untrackedListArgv = ['ls-files', '--others', '--exclude-standard', '-z'];

/** `git log` format parsed by {@link parseLog}: unit-separated fields, record-separated commits. */
export const logFormat = '%H%x1f%h%x1f%ct%x1f%s%x1e';
/** Commits listed for Unpushed; past this the list stops being reviewable. */
export const commitLimit = 200;

export function logArgv(base: string): string[] {
  return ['log', '--no-show-signature', `--format=${logFormat}`, `--max-count=${commitLimit}`, `${base}..HEAD`, '--'];
}

export function parseLog(text: string): Commit[] {
  return text.split('\x1e').map(record => record.replace(/^\n/, '')).filter(Boolean).map(record => {
    const [sha = '', shortSha = '', time = '0', ...subject] = record.split('\x1f');
    return { sha, shortSha, time: Number(time), subject: subject.join('\x1f') };
  });
}

/** Where unpushed work starts: the upstream, else `origin/HEAD`, as the `review` function does. */
export function unpushedTip(refs: { upstream: string | null; originHead: string | null }): { ref: string; label: string } | null {
  if (refs.upstream) return { ref: '@{upstream}', label: refs.upstream };
  if (refs.originHead) return { ref: 'origin/HEAD', label: 'origin/HEAD' };
  return null;
}

/** Refs tried, in order, when `origin/HEAD` is not set. */
export const defaultBranchCandidates = ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'];

/** The default branch: what `origin/HEAD` points at, else the first candidate that exists. */
export function pickDefaultBranch(originHead: string | null, present: ReadonlySet<string>): string | null {
  return originHead ?? defaultBranchCandidates.find(ref => present.has(ref)) ?? null;
}

/** `refs/remotes/origin/main` to `origin/main`, `refs/heads/main` to `main`. */
export const shortRef = (ref: string) => ref.replace(/^refs\/(remotes|heads)\//, '');

/**
 * Tell the reader when Branch shows nothing Unpushed or Uncommitted would not.
 * `unpushedBase` is null when the checkout has no upstream.
 */
export function branchNote(input: { branchBase: string; unpushedBase: string | null; head: string; defaultBranch: string }): string | null {
  const name = shortRef(input.defaultBranch);
  if (input.branchBase === input.head) return `No commits since ${name}: Branch equals Uncommitted.`;
  if (input.unpushedBase === input.branchBase) return `${name} and the upstream share a base: Branch equals Unpushed plus uncommitted changes.`;
  return null;
}

/** One commit against its first parent; a root commit against the empty tree. */
export function commitSpec(sha: string, parent: string | null, emptyTree: string): Spec {
  return { from: parent ?? emptyTree, to: sha, untracked: false };
}
