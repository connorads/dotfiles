// Host-side git I/O. Runs in the host worker on the checkout's own machine.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { Body, Commit, FileDiff, LoadResult, Scope, Spec } from '../contracts.ts';
import { isLockfile, compareFiles, planLoad } from './files.ts';
import { gitEnv } from './git-env.ts';
import { parsePatch, type ParsedFile } from './patch.ts';
import {
  branchNote, commitLimit, commitSpec, defaultBranchCandidates, globalFlags, logArgv, parseLog, patchArgv,
  pickDefaultBranch, shortRef, statArgv, unpushedTip, untrackedArgv, untrackedListArgv,
} from './scope.ts';
import { joinStats, parseStatusPaths, parseUntracked, type StatEntry } from './stat.ts';
import { displayLimits, expandedLimits, truncatePatch, type Limits } from './truncate.ts';

export interface Repo {
  kind: 'repo' | 'dotfiles';
  name: string;
  /** Directory git runs in: the work tree's top level. */
  cwd: string;
  /** Options that select the repository, before the subcommand. */
  select: string[];
}

/** Files listed per load; past this the scroll stops being readable. */
const fileLimit = 2_000;
const untrackedConcurrency = 8;

export function run(cwd: string, args: string[], okCodes: readonly number[] = [0]): Promise<string> {
  return new Promise((resolve, reject) => {
    // GIT_OPTIONAL_LOCKS=0 skips optional index writes; `git diff` ignores it, hence diff.autoRefreshIndex=false in globalFlags.
    execFile('git', args, {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000,
      env: gitEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }),
    }, (error, stdout, stderr) => {
      const code = error ? typeof error.code === 'number' ? error.code : -1 : 0;
      if (okCodes.includes(code)) resolve(stdout);
      else reject(new Error(stderr.trim() || error?.message || `git ${args[0]} failed`));
    });
  });
}
const git = (repo: Repo, args: string[], okCodes?: readonly number[]) => run(repo.cwd, [...repo.select, ...globalFlags, ...args], okCodes);
/** A revision's full sha, or null when it does not resolve. */
const verify = (repo: Repo, rev: string) =>
  git(repo, ['rev-parse', '--verify', '-q', '--end-of-options', `${rev}^{commit}`], [0, 1, 128]).then(out => out.trim() || null);
const mergeBase = (repo: Repo, a: string, b: string) => git(repo, ['merge-base', a, b], [0, 1]).then(out => out.trim() || null);

const trimSlash = (path: string) => path.length > 1 ? path.replace(/\/+$/, '') : path;

/**
 * The checkout's repository, or the bare dotfiles repository when the checkout
 * is the home directory and no repository encloses it (the `lgdf` fallback).
 */
export async function resolveRepo(root: string, home: string): Promise<Repo | null> {
  const top = await run(root, ['rev-parse', '--show-toplevel']).then(out => out.trim(), () => null);
  if (top) return { kind: 'repo', name: basename(top), cwd: top, select: [] };
  const dotfiles = join(home, 'git', 'dotfiles');
  if (trimSlash(root) !== trimSlash(home) || !await access(join(dotfiles, 'HEAD')).then(() => true, () => false)) return null;
  return { kind: 'dotfiles', name: 'dotfiles', cwd: home, select: [`--git-dir=${dotfiles}`, `--work-tree=${home}`] };
}

type Resolved = { ok: true; spec: Spec; label: string; commits: Commit[] | null; note: string | null } | { ok: false; message: string };
const fail = (message: string): Resolved => ({ ok: false, message });

async function resolveScope(repo: Repo, scope: Scope, head: string | null, emptyTree: string): Promise<Resolved> {
  // The home checkout is all of ~; listing its untracked files would scan every file there.
  const untracked = repo.kind === 'repo';
  if (scope.kind === 'uncommitted') {
    return { ok: true, spec: { from: head ?? emptyTree, to: null, untracked }, label: head ? 'HEAD' : 'empty tree', commits: null,
      note: untracked ? null : 'Tracked files only: untracked files under ~ are not scanned.' };
  }
  if (!head) return fail('No commits yet.');
  const [upstream, originHead] = await Promise.all([
    git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(out => out.trim() || null, () => null),
    verify(repo, 'origin/HEAD'),
  ]);
  const tip = unpushedTip({ upstream, originHead });
  const tipSha = tip && await verify(repo, tip.ref);
  const unpushedBase = tipSha && await mergeBase(repo, tipSha, head);

  if (scope.kind === 'unpushed') {
    if (!tip || !tipSha) return fail('No upstream and no origin/HEAD, so nothing marks what is pushed.');
    if (!unpushedBase) return fail(`${tip.label} shares no history with HEAD.`);
    const commits = parseLog(await git(repo, logArgv(tipSha)));
    const note = commits.length === 0 ? `Nothing unpushed: HEAD is already in ${tip.label}.`
      : commits.length >= commitLimit ? `The list shows the newest ${commitLimit} commits; the diff covers them all.` : null;
    if (!scope.commit) return { ok: true, spec: { from: unpushedBase, to: head, untracked: false }, label: `${tip.label}..HEAD`, commits, note };
    const picked = commits.find(commit => commit.sha === scope.commit);
    if (!picked) return fail('That commit is no longer unpushed. Click Unpushed to show all commits.');
    const parent = await verify(repo, `${picked.sha}^1`);
    return { ok: true, spec: commitSpec(picked.sha, parent, emptyTree), label: `${picked.shortSha} ${picked.subject}`, commits, note };
  }

  const [symbolic, present] = await Promise.all([
    git(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], [0, 1, 128]).then(out => out.trim() || null),
    git(repo, ['for-each-ref', '--format=%(refname)', ...defaultBranchCandidates]).then(out => new Set(out.split('\n').filter(Boolean))),
  ]);
  // origin/HEAD can outlive the branch it names; a dangling one falls through to the candidates.
  const defaultBranch = pickDefaultBranch(symbolic && await verify(repo, symbolic) ? symbolic : null, present);
  if (!defaultBranch) return fail('No default branch: origin/HEAD, main and master are all missing.');
  const branchBase = await mergeBase(repo, defaultBranch, head);
  if (!branchBase) return fail(`${shortRef(defaultBranch)} shares no history with HEAD.`);
  return { ok: true, spec: { from: branchBase, to: null, untracked }, label: `${shortRef(defaultBranch)}...HEAD + uncommitted`, commits: null,
    note: branchNote({ branchBase, unpushedBase: unpushedBase ?? null, head, defaultBranch }) };
}

/** Run `task` over `items` with at most `limit` in flight, keeping order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]!); }
  }));
  return results;
}

function bodyOf(parsed: ParsedFile | undefined, limits: Limits): Body {
  if (!parsed) return { kind: 'empty' };
  if (parsed.binary) return { kind: 'binary' };
  if (parsed.hunks === 0) return { kind: 'empty' };
  return { kind: 'patch', ...truncatePatch(parsed.patch, limits) };
}

const untrackedPatch = (repo: Repo, path: string) =>
  git(repo, untrackedArgv(path), [0, 1]).then(out => parsePatch(out)[0], () => undefined);

async function changedFiles(repo: Repo, spec: Spec): Promise<{ files: FileDiff[]; hidden: number }> {
  const [names, counts, others] = await Promise.all([
    git(repo, statArgv(spec, '--name-status')),
    git(repo, statArgv(spec, '--numstat')),
    spec.untracked ? git(repo, untrackedListArgv) : Promise.resolve(''),
  ]);
  const all = [...joinStats(names, counts), ...parseUntracked(others)].sort(compareFiles);
  const entries = all.slice(0, fileLimit);
  const sizes = new Map(await mapLimited(entries.filter(entry => entry.untracked), 32,
    async entry => [entry.path, await lstat(join(repo.cwd, entry.path)).then(info => info.size, () => 0)] as const));
  const plan = planLoad(entries, sizes);

  const inline = entries.filter((entry, i) => plan[i]!.kind === 'inline');
  const tracked = inline.filter(entry => !entry.untracked).flatMap(entry => entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]);
  const parsed = new Map<string, ParsedFile>();
  if (tracked.length) for (const file of parsePatch(await git(repo, patchArgv(spec, tracked)))) parsed.set(file.path, file);
  const fresh = inline.filter(entry => entry.untracked);
  (await mapLimited(fresh, untrackedConcurrency, entry => untrackedPatch(repo, entry.path)))
    .forEach((file, i) => { if (file) parsed.set(fresh[i]!.path, file); });

  const files = entries.map((entry: StatEntry, i): FileDiff => {
    const decision = plan[i]!;
    const file = parsed.get(entry.path);
    const body: Body = decision.kind === 'deferred' ? { kind: 'deferred', reason: decision.reason }
      : decision.kind === 'binary' ? { kind: 'binary' } : bodyOf(file, displayLimits);
    // An untracked file's counts come from its patch, when one was read and is not binary.
    const counted = entry.untracked ? file && !file.binary ? file : null : entry;
    return {
      path: entry.path, oldPath: entry.oldPath, status: entry.status,
      additions: counted?.additions ?? null, deletions: counted?.deletions ?? null,
      untracked: entry.untracked, lockfile: isLockfile(entry.path), modeChange: file?.modeChange ?? null, body,
    };
  });
  return { files, hidden: all.length - entries.length };
}

export async function load(root: string, home: string, scope: Scope): Promise<LoadResult> {
  const repo = await resolveRepo(root, home);
  if (!repo) return { kind: 'none' };
  const [head, branch, emptyTree] = await Promise.all([
    verify(repo, 'HEAD'),
    git(repo, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]).then(out => out.trim() || null),
    git(repo, ['hash-object', '-t', 'tree', '/dev/null']).then(out => out.trim()),
  ]);
  const resolved = await resolveScope(repo, scope, head, emptyTree);
  const base = { kind: repo.kind, name: repo.name, branch };
  if (!resolved.ok) return { ...base, view: resolved };
  const { files, hidden } = await changedFiles(repo, resolved.spec);
  return { ...base, view: { ok: true, spec: resolved.spec, label: resolved.label, commits: resolved.commits, note: resolved.note, files, hidden } };
}

/**
 * A hash that changes when HEAD, the upstream, origin/HEAD, a default-branch
 * candidate, the status or a listed file's size or mtime changes. Status shows the index's blob, not the work tree's,
 * so a second edit to a modified file shows only in its stat data.
 */
export async function fingerprint(root: string, home: string): Promise<string | null> {
  const repo = await resolveRepo(root, home);
  if (!repo) return null;
  const untracked = repo.kind === 'repo' ? '--untracked-files=all' : '--untracked-files=no';
  const [status, refs] = await Promise.all([
    git(repo, ['status', '--porcelain=v2', '-z', '--branch', untracked]),
    git(repo, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)', 'refs/remotes/origin/HEAD', ...defaultBranchCandidates]),
  ]);
  const stats = await mapLimited(parseStatusPaths(status), 32,
    path => lstat(join(repo.cwd, path)).then(info => `${info.size}:${info.mtimeMs}`, () => '-'));
  return createHash('sha1').update(status).update(refs).update(stats.join('\n')).digest('hex');
}

function relative(path: string) {
  if (!path || isAbsolute(path) || path.split('/').includes('..')) throw new Error(`Refusing a path outside the repository: ${path}`);
  return path;
}

/** One file's patch, cut only at the expanded limits. */
export async function loadFile(root: string, home: string, input: { spec: Spec; path: string; oldPath: string | null; untracked: boolean }): Promise<Body> {
  const repo = await resolveRepo(root, home);
  if (!repo) throw new Error(`${root} is not a git work tree.`);
  const path = relative(input.path);
  if (input.untracked) {
    // Read only a file the listing would show: never an ignored file, nor any file under ~.
    const listed = repo.kind === 'repo' && input.spec.untracked
      && parseUntracked(await git(repo, [...untrackedListArgv, '--', path])).some(entry => entry.path === path);
    if (!listed) throw new Error(`Not an untracked file: ${path}`);
    return bodyOf(await untrackedPatch(repo, path), expandedLimits);
  }
  const paths = input.oldPath ? [relative(input.oldPath), path] : [path];
  const files = parsePatch(await git(repo, patchArgv(input.spec, paths)));
  return bodyOf(files.find(file => file.path === path) ?? files[0], expandedLimits);
}
