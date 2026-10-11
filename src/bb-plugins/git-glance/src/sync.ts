import { spawn } from 'node:child_process';
import { gitEnv } from './git-env.ts';
import { parseStatus } from './porcelain.ts';
import { classifyFailure, parsePushPorcelain, parseProgress, shortRef, type Failure, type OpKind, type Progress } from './remote.ts';
import { git, type Repo } from './repo.ts';

export type SyncResult = { ok: true; summary: string } | { ok: false; failure: Failure };

// Never prompt: with no terminal to answer it, a prompt would hang until the timeout.
// Credential helpers (osxkeychain) and a running ssh-agent still work.
const remoteEnv = {
  LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  SSH_ASKPASS_REQUIRE: 'never', GIT_SEQUENCE_EDITOR: ':', GIT_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no',
};

interface Spawned { code: number | null; stdout: string; output: string; aborted: 'cancelled' | 'timeout' | null }

function spawnGit(repo: Repo, args: string[], options: { signal: AbortSignal; timeoutMs: number; onProgress(progress: Progress): void }) {
  return new Promise<Spawned>(resolve => {
    // A process group of its own, so cancelling also stops ssh and remote helpers.
    const child = spawn('git', [...repo.select, '-c', 'credential.interactive=never', ...args],
      { cwd: repo.cwd, env: gitEnv(remoteEnv), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', output = '';
    let aborted: Spawned['aborted'] = null;
    const stop = (why: 'cancelled' | 'timeout') => {
      if (aborted || child.exitCode !== null) return;
      aborted = why;
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    };
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    const onAbort = () => stop('cancelled');
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) onAbort();
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
      const progress = parseProgress(chunk);
      if (progress) options.onProgress(progress);
    });
    const finish = (code: number | null) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout, output, aborted });
    };
    child.on('error', error => { output += error.message; finish(-1); });
    child.on('close', finish);
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const count = async (repo: Repo, range: string[]) =>
  Number((await git(repo, ['rev-list', '--count', ...range]).catch(() => '0')).trim()) || 0;
const head = (repo: Repo) => git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], [0, 1]).then(out => out.trim());

/** The remote `push -u` should publish to: `origin`, else the only remote. */
export function publishRemote(remotes: readonly string[]): string | null {
  return remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : null;
}

export async function sync(repo: Repo, op: OpKind, options: { signal: AbortSignal; timeoutMs: number; onProgress(progress: Progress): void }): Promise<SyncResult> {
  const status = parseStatus(await git(repo, ['status', '--porcelain=v2', '--branch', '-z', '-uno']));
  const remotes = (await git(repo, ['remote'])).split('\n').filter(Boolean);
  if (remotes.length === 0) return { ok: false, failure: { reason: 'no-remote', message: 'This repository has no remotes.' } };
  const { branch } = status;
  const fail = (result: Spawned): SyncResult => ({ ok: false, failure: result.aborted
    ? { reason: result.aborted, message: result.aborted === 'timeout' ? `git ${op} took longer than ${options.timeoutMs / 1000}s.` : `git ${op} was cancelled.` }
    : classifyFailure(result.output) });

  if (op === 'fetch') {
    const result = await spawnGit(repo, ['fetch', '--prune', '--progress'], options);
    if (result.code !== 0) return fail(result);
    if (!branch.upstream) return { ok: true, summary: 'Fetched' };
    const behind = await count(repo, ['HEAD..@{upstream}']);
    return { ok: true, summary: behind ? `${plural(behind, 'new commit')} on ${branch.upstream}` : `Up to date with ${branch.upstream}` };
  }

  if (op === 'pull') {
    if (!branch.head) return { ok: false, failure: { reason: 'unknown', message: 'HEAD is detached. Check out a branch to pull.' } };
    if (!branch.upstream) return { ok: false, failure: { reason: 'no-remote', message: `${branch.head} has no upstream branch to pull from.` } };
    const before = await head(repo);
    // --ff-only: a pop-up should never start a merge or rebase that can stop half way.
    const result = await spawnGit(repo, ['pull', '--ff-only', '--progress', '--no-edit'], options);
    if (result.code !== 0) return fail(result);
    const pulled = before ? await count(repo, [`${before}..HEAD`]) : 0;
    return { ok: true, summary: pulled ? `Pulled ${plural(pulled, 'commit')} from ${branch.upstream}` : `Already up to date with ${branch.upstream}` };
  }

  if (!branch.head) return { ok: false, failure: { reason: 'unknown', message: 'HEAD is detached. Check out a branch to push.' } };
  const remote = branch.upstream ? null : publishRemote(remotes);
  if (!branch.upstream && !remote) {
    return { ok: false, failure: { reason: 'no-remote', message: `Several remotes and no origin: choose one with git push -u <remote> ${branch.head}.` } };
  }
  const ahead = branch.upstream ? branch.ahead : await count(repo, ['HEAD', '--not', '--remotes']);
  const result = await spawnGit(repo, ['push', '--porcelain', '--progress', ...(remote ? ['-u', remote, 'HEAD'] : [])], options);
  const refs = parsePushPorcelain(result.stdout);
  if (result.code !== 0 || refs.some(ref => ref.flag === '!')) return fail(result);
  const target = remote ? `${remote}/${shortRef(refs[0]?.to ?? branch.head)}` : branch.upstream!;
  if (refs.every(ref => ref.flag === '=')) return { ok: true, summary: `${target} is already up to date` };
  return { ok: true, summary: remote ? `Published ${branch.head} to ${target}` : `Pushed ${plural(ahead, 'commit')} to ${target}` };
}
