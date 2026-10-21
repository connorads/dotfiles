import { spawn } from 'node:child_process';
import { gitEnv } from './git-env.ts';
import { classifyFailure, parseProgress, type Failure, type Progress } from './remote.ts';
import type { Repo } from './repo.ts';

/** What every operation reports: a one-line summary, or a reason a person can act on. */
export type OpResult = { ok: true; summary: string } | { ok: false; failure: Failure };
export interface OpOptions { signal: AbortSignal; timeoutMs: number; onProgress(progress: Progress): void; input?: string }

// Never prompt: with no terminal to answer it, a prompt would hang until the timeout.
// Credential helpers (osxkeychain) and a running ssh-agent still work.
const remoteEnv = {
  LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  SSH_ASKPASS_REQUIRE: 'never', GIT_SEQUENCE_EDITOR: ':', GIT_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no',
};

export interface Spawned { code: number | null; stdout: string; output: string; aborted: 'cancelled' | 'timeout' | null }

export function spawnGit(repo: Repo, args: string[], options: OpOptions) {
  return new Promise<Spawned>(resolve => {
    // A process group of its own, so cancelling also stops ssh and remote helpers.
    const child = spawn('git', [...repo.select, '-c', 'credential.interactive=never', ...args],
      { cwd: repo.cwd, env: gitEnv(remoteEnv), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
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

/** The failure for a git run that exited badly, was cancelled or timed out. */
export function failed(result: Spawned, what: string, timeoutMs: number): OpResult {
  return { ok: false, failure: result.aborted
    ? { reason: result.aborted, message: result.aborted === 'timeout' ? `git ${what} took longer than ${timeoutMs / 1000}s.` : `git ${what} was cancelled.` }
    : classifyFailure(result.output) };
}
