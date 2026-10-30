import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface CommandResult { code: number; stdout: string; stderr: string }
export interface RunOptions { cwd?: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number }
export type Run = (command: string, args: readonly string[], options?: RunOptions) => Promise<CommandResult>;

const repositoryVariables = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

async function loginAgent(): Promise<string> {
  if (process.platform !== 'darwin') return '';
  return new Promise(resolve => {
    execFile('/bin/launchctl', ['getenv', 'SSH_AUTH_SOCK'], { timeout: 1000, maxBuffer: 4096 }, (error, stdout) => {
      resolve(error ? '' : stdout.trim());
    });
  });
}

export const run: Run = async (command, args, options = {}) => {
  const socket = await loginAgent();
  return new Promise(resolve => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [join(homedir(), '.local', 'bin'), process.env.PATH ?? ''].join(delimiter),
      ...(socket ? { SSH_AUTH_SOCK: socket } : {}),
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
      GH_PROMPT_DISABLED: '1',
    };
    for (const variable of repositoryVariables) delete env[variable];
    const limit = options.maxBytes ?? 1_048_576;
    const child = spawn(command, [...args], {
      cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 30_000, signal: options.signal,
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    let exceeded = false;
    const collect = (channel: 'stdout' | 'stderr', chunk: string) => {
      const remaining = Math.max(0, limit - size);
      const text = Buffer.from(chunk).subarray(0, remaining).toString();
      if (channel === 'stdout') stdout += text;
      else stderr += text;
      size += Buffer.byteLength(chunk);
      if (size > limit && !exceeded) { exceeded = true; child.kill('SIGKILL'); }
    };
    child.stdout.setEncoding('utf8').on('data', chunk => collect('stdout', String(chunk)));
    child.stderr.setEncoding('utf8').on('data', chunk => collect('stderr', String(chunk)));
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({ code: error.code === 'ENOENT' ? 127 : 128, stdout, stderr: error.code === 'ENOENT' ? `${command} not found on this Mac's PATH.` : error.message });
    });
    child.on('close', (code, signal) => {
      resolve({ code: exceeded ? 128 : code ?? 128, stdout, stderr: exceeded ? 'Command exceeded its output limit.' : signal ? `Command stopped (${signal}). ${stderr}`.trim() : stderr });
    });
  });
};
