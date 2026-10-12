import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { parseUsage, type Usage } from './usage.ts';

export const authOverrides = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'] as const;
// BB passes an empty value through, and Claude resolves an empty CLAUDE_CONFIG_DIR against the working directory.
export function providerEnv(configDir: string | null) {
  if (configDir === null) return [];
  return [{ name: 'CLAUDE_CONFIG_DIR', value: configDir, reason: 'Thread Claude profile' },
    ...authOverrides.map(name => ({ name, value: '', reason: 'Use selected profile native login' }))];
}
export function profileEnvironment(configDir: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [...authOverrides, 'CLAUDECODE', 'CLAUDE_CONFIG_DIR']) delete env[key];
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}
const responseSchema = z.object({ type: z.literal('control_response'), response: z.object({
  request_id: z.string(), subtype: z.string(), response: z.unknown().optional(),
}) });
export async function checkLogin(executable: string, configDir: string | null, signal: AbortSignal): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(executable, ['auth', 'status', '--json'], {
      env: profileEnvironment(configDir), signal, timeout: 10000, maxBuffer: 65536,
    }));
  } catch { throw new Error('Native Claude login check failed. Sign in to this profile with the CLI.'); }
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { throw new Error('Claude returned an unsupported login status.'); }
  if (!z.object({ loggedIn: z.literal(true) }).safeParse(value).success) {
    throw new Error('This profile is not signed in. Use native Claude login first.');
  }
}

/** Sends control requests only. No user message or model prompt is created. */
export async function collectUsage(executable: string, configDir: string | null, cwd: string, signal: AbortSignal): Promise<Usage> {
  const child = spawn(executable, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
  { cwd, env: profileEnvironment(configDir), stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let stopped = false;
  const exited = new Promise<void>(resolve => child.once('close', () => { stopped = true; resolve(); }));
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    if (stopped) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
  }
  try {
    return await new Promise<Usage>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Claude quota request timed out.')), 25000);
      let complete = false;
      let size = 0;
      function finish(error: Error | null, usage?: Usage) {
        if (complete) return;
        complete = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else if (usage) resolve(usage);
        stop();
      }
      const abort = () => finish(new Error('Claude quota request cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(new Error('Could not start Claude. Check the executable setting.')));
      child.on('close', () => finish(new Error('Claude exited before returning usage. Sign in with the native CLI.')));
      child.stdin.on('error', () => finish(new Error('Claude control connection closed.')));
      child.stdout.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 2 * 1024 * 1024) finish(new Error('Claude quota output exceeded the limit.'));
      });
      function send(id: string, request: Record<string, unknown>) {
        child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n');
      }
      lines.on('line', line => {
        if (complete) return;
        let decoded: unknown;
        try { decoded = JSON.parse(line); } catch { return; }
        const parsed = responseSchema.safeParse(decoded);
        if (!parsed.success) return;
        const response = parsed.data.response;
        if (!['init', 'usage'].includes(response.request_id)) return;
        if (response.subtype !== 'success') { finish(new Error('Claude rejected the quota request. Check native login and CLI version.')); return; }
        if (response.request_id === 'init') send('usage', { subtype: 'get_usage', skip_behaviors: true });
        else finish(null, parseUsage(response.response));
      });
      if (signal.aborted) abort();
      else send('init', { subtype: 'initialize' });
    });
  } finally {
    lines.close();
    stop();
    await exited;
    if (killTimer) clearTimeout(killTimer);
  }
}
