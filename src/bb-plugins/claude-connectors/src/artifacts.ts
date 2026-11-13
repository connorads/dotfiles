import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { toolSchema, type Tool } from './mcp.ts';

export const ARTIFACT_CONNECTOR = { id: 'native-artifacts', name: 'Claude Code Artifacts' };
const NAMES = new Set(['Artifact', 'ArtifactComments', 'ArtifactData']);
const replySchema = z.object({
  id: z.number(), result: z.unknown().optional(), error: z.object({ message: z.string() }).optional(),
});
export type ArtifactCall = { profile: string; tool: string; args: Record<string, unknown>; signal?: AbortSignal };
export type Artifacts = {
  tools: (profile: string, signal?: AbortSignal) => Promise<Tool[]>;
  call: (request: ArtifactCall) => Promise<unknown>;
};
type Launch = { executable: () => string; configDir: (profile: string) => string };

/** Native Claude Code owns authentication. This transport never reads its credentials. */
export class NativeArtifacts implements Artifacts {
  private readonly launch: Launch;
  constructor(launch: Launch) { this.launch = launch; }

  async #request(request: { profile: string; method: string; params: Record<string, unknown>; signal?: AbortSignal }): Promise<unknown> {
    request.signal?.throwIfAborted();
    const cwd = await mkdtemp(join(tmpdir(), 'bb-artifacts-'));
    const configDir = this.launch.configDir(request.profile);
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_ARTIFACT: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDECODE',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
    const signal = AbortSignal.any([request.signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]);
    const child = spawn(this.launch.executable(), ['mcp', 'serve'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], signal });
    const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
    const lines = createInterface({ input: child.stdout });
    try {
      return await new Promise((resolve, reject) => {
        let bytes = 0;
        const send = (message: Record<string, unknown>) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
        child.on('error', () => reject(new Error('Claude Code artefact process failed or was cancelled.')));
        child.stdin.on('error', () => reject(new Error('Claude Code artefact input closed.')));
        child.on('exit', () => reject(new Error('Claude Code exited before replying to the artefact request.')));
        lines.on('line', line => {
          bytes += Buffer.byteLength(line);
          if (bytes > 4 * 1024 * 1024) { reject(new Error('Claude Code artefact reply exceeded 4 MiB.')); return; }
          try {
            const parsed = replySchema.safeParse(JSON.parse(line));
            if (!parsed.success) return;
            const reply = parsed.data;
            if (reply.error) { reject(new Error(`Claude Code artefact request failed: ${reply.error.message}`)); return; }
            if (reply.id === 1) {
              send({ method: 'notifications/initialized' });
              send({ id: 2, method: request.method, params: request.params });
            } else if (reply.id === 2) resolve(reply.result);
          } catch { reject(new Error('Claude Code returned an invalid artefact reply.')); }
        });
        send({ id: 1, method: 'initialize', params: {
          protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bb-claude-connectors', version: '0.1.0' },
        } });
      });
    } finally {
      lines.close();
      child.stdin.destroy();
      if (child.exitCode === null) child.kill();
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
      try { await closed; } finally { clearTimeout(forceKill); }
    }
  }

  async tools(profile: string, signal?: AbortSignal): Promise<Tool[]> {
    const reply = await this.#request({ profile, method: 'tools/list', params: {}, signal });
    return z.object({ tools: z.array(toolSchema) }).parse(reply).tools
      .filter(tool => NAMES.has(tool.name))
      // Each native tool combines read and write actions. None is read-only.
      .map(tool => ({ ...tool, annotations: { ...tool.annotations, readOnlyHint: false } }));
  }

  async call({ profile, tool, args, signal }: ArtifactCall): Promise<unknown> {
    if (!NAMES.has(tool)) throw new Error('Only Claude Code artefact tools are available through this connector.');
    return this.#request({ profile, method: 'tools/call', params: { name: tool, arguments: args }, signal });
  }
}
