// Process runner for the host worker. argv-form spawn, payload on stdin, so
// refs never pass through a shell.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Run } from './skl.ts';

export type RunnerOptions = {
  readonly command: string;
  readonly timeoutMs: number;
  /** Extra PATH entries, searched first. */
  readonly pathPrefix?: readonly string[];
  readonly signal?: AbortSignal;
};

/**
 * The tmux picker prepends ~/.local/bin because the popup shell is
 * non-interactive; the host worker's normalised PATH may lack it too.
 */
export const defaultPathPrefix = (): string[] => [join(homedir(), '.local', 'bin')];

// Every variable here redirects git to another repository, index or object store
// (`git rev-parse --local-env-vars`). Git exports some of them to hooks, and
// `skl install` finds its project with `git -C <cwd> rev-parse`, so an
// inherited one would install into the hook's repository instead of the thread's.
const gitRepositoryVars = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

export function createRunner(options: RunnerOptions): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [...(options.pathPrefix ?? []), process.env.PATH ?? ''].filter(Boolean).join(delimiter) };
  for (const name of gitRepositoryVars) delete env[name];
  return (argv, { cwd, stdin } = {}) => new Promise(resolve => {
    const child = spawn(options.command, [...argv], {
      cwd, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: options.timeoutMs, signal: options.signal,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      resolve({ code: 127, stdout, stderr: missing ? `${options.command} not found on PATH` : error.message });
    });
    child.on('close', (code, signal) => {
      resolve({ code: code ?? 128, stdout, stderr: signal ? `${stderr}${options.command} stopped by ${signal}`.trim() : stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}
