import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { claudeLaunchOverrides, nativeResult, type NativeResult, type NativeReport } from './native-contract';

const tokens = z.number().finite().nonnegative();
const named = z.object({ name: z.string().max(1000), tokens });
const reportSchema = z.object({
  model: z.string().max(200), totalTokens: tokens,
  categories: z.array(z.object({ id: z.string().max(200), name: z.string().max(1000),
    kind: z.enum(['used', 'buffer', 'free', 'deferred']), tokens })).max(100),
  systemPromptSections: z.array(named).max(500).default([]),
  systemTools: z.array(named).max(500).default([]),
  mcpTools: z.array(named.extend({ serverName: z.string().max(1000), isLoaded: z.boolean().default(true) })).max(500).default([]),
  mcpInstructions: z.array(z.object({ serverName: z.string().max(1000), tokens })).max(500).default([]),
  memoryFiles: z.array(z.object({ path: z.string().max(2000), tokens })).max(500).default([]),
  agents: z.array(z.object({ agentType: z.string().max(1000), source: z.string().max(1000), tokens })).max(500).default([]),
  skills: z.object({ skillFrontmatter: z.array(named).max(500) }).optional(),
  deferredBuiltinTools: z.array(named.extend({ isLoaded: z.boolean() })).max(500).default([]),
  messageBreakdown: z.object({
    toolCallTokens: tokens.default(0), toolResultTokens: tokens.default(0), attachmentTokens: tokens.default(0),
    assistantMessageTokens: tokens.default(0), userMessageTokens: tokens.default(0),
    redirectedContextTokens: tokens.default(0), unattributedTokens: tokens.default(0),
  }).optional(),
});

function projectReport(value: unknown, sessionId: string, readiness: string[]): NativeResult {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) return { kind: 'unavailable', reason: 'Claude returned an unsupported context report.' };
  const report = parsed.data;
  const hasDeferredMcp = report.categories.some(c => c.kind === 'deferred' && c.id.includes('mcp'));
  const categories: NativeReport['categories'] = report.categories.map(category => {
    let rows: { name: string; tokens: number }[] = [];
    switch (category.id) {
      case 'system_prompt': rows = report.systemPromptSections; break;
      case 'system_tools': rows = report.systemTools; break;
      case 'system_tools_deferred': rows = report.deferredBuiltinTools.filter(t => !t.isLoaded); break;
      case 'mcp_tools':
      case 'mcp_tools_deferred': rows = report.mcpTools
        .filter(t => !hasDeferredMcp || t.isLoaded === (category.kind !== 'deferred'))
        .map(t => ({ name: `${t.serverName}: ${t.name}`, tokens: t.tokens })); break;
      case 'mcp_instructions': rows = report.mcpInstructions.map(t => ({ name: t.serverName, tokens: t.tokens })); break;
      case 'memory_files': rows = report.memoryFiles.map(t => ({ name: t.path, tokens: t.tokens })); break;
      case 'custom_agents': rows = report.agents.map(t => ({ name: `${t.agentType} (${t.source})`, tokens: t.tokens })); break;
      case 'skills': rows = report.skills?.skillFrontmatter ?? []; break;
      case 'messages': {
        const b = report.messageBreakdown;
        if (b) rows = [
          { name: 'Tool results', tokens: b.toolResultTokens }, { name: 'Assistant messages', tokens: b.assistantMessageTokens },
          { name: 'User messages', tokens: b.userMessageTokens }, { name: 'Tool calls', tokens: b.toolCallTokens },
          { name: 'Attachments', tokens: b.attachmentTokens }, { name: 'Redirected context', tokens: b.redirectedContextTokens },
          { name: 'Unattributed', tokens: b.unattributedTokens },
        ];
      }
    }
    return { id: category.id, label: category.name, kind: category.kind === 'buffer' ? 'reserved' : category.kind,
      tokens: category.tokens, entries: rows.filter(row => row.tokens > 0).map((row, index) => ({ id: `${category.id}:${index}`, label: row.name, tokens: row.tokens })) };
  });
  return nativeResult.parse({ kind: 'available', provider: 'claude-code', scope: 'saved-session',
    capturedAt: new Date().toISOString(), providerSessionId: sessionId, requestId: null,
    method: 'Claude native summary estimates', totalTokens: report.totalTokens, categories,
    notes: [
      `Model: ${report.model}. Saved-session diagnostic; not a live-memory measurement.`,
      'Current BB-injected tools and launch overrides may differ from this restored native configuration.',
      'Source estimates can overlap or exceed their parent. Skill counts cover listings, not complete bodies.',
      ...readiness,
    ],
  });
}

/** A read-only summary control exchange. No user prompt or full recount is sent. */
export async function collectClaude(input: { sessionId: string; cwd: string; configDir?: string }, signal?: AbortSignal): Promise<NativeResult> {
  if (signal?.aborted) return { kind: 'unavailable', reason: 'Claude context request cancelled.' };
  if (!z.string().uuid().safeParse(input.sessionId).success || !isAbsolute(input.cwd) || (input.configDir !== undefined && !isAbsolute(input.configDir))) {
    return { kind: 'unavailable', reason: 'Claude context target is invalid.' };
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  delete env.CLAUDECODE;
  // Only the server-resolved account directory belongs to this target.
  for (const key of ['CLAUDE_CONFIG_DIR', ...claudeLaunchOverrides]) delete env[key];
  if (input.configDir !== undefined) env.CLAUDE_CONFIG_DIR = input.configDir;
  return new Promise(resolve => {
    const child = spawn('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--resume', input.sessionId, '--fork-session', '--no-session-persistence',
      '--setting-sources', 'user,project,local', '--settings', '{"disableAllHooks":true}'],
    { cwd: input.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let settled = false;
    let closed = false;
    let result: NativeResult | undefined;
    let buffer = '';
    let bytes = 0;
    const readiness: string[] = [];
    const started = Date.now();
    let poll: ReturnType<typeof setTimeout> | undefined;
    let force: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: NativeResult) => {
      if (settled) return;
      settled = true; result = value;
      clearTimeout(timeout); clearTimeout(poll);
      signal?.removeEventListener('abort', abort);
      if (closed) { resolve(value); return; }
      child.stdin.end();
      child.kill('SIGTERM');
      force = setTimeout(() => { child.kill('SIGKILL'); resolve(value); }, 500);
      force.unref();
    };
    const abort = () => finish({ kind: 'unavailable', reason: 'Claude context request cancelled.' });
    const send = (requestId: string, request: Record<string, unknown>) => {
      if (!settled) child.stdin.write(JSON.stringify({ type: 'control_request', request_id: requestId, request }) + '\n');
    };
    const timeout = setTimeout(() => finish({ kind: 'unavailable', reason: 'Claude context request timed out.' }), 10000);
    child.stdin.on('error', () => finish({ kind: 'unavailable', reason: 'Claude context process stopped.' }));
    child.on('error', () => finish({ kind: 'unavailable', reason: 'Claude executable could not be started.' }));
    child.on('close', () => {
      closed = true;
      clearTimeout(force);
      if (!settled) finish({ kind: 'unavailable', reason: 'Claude context process stopped before reporting.' });
      resolve(result ?? { kind: 'unavailable', reason: 'Claude context process stopped before reporting.' });
    });
    child.stderr.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) finish({ kind: 'unavailable', reason: 'Claude context response exceeded its size limit.' });
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) return finish({ kind: 'unavailable', reason: 'Claude context response exceeded its size limit.' });
      buffer += chunk.toString();
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message: unknown;
        try { message = JSON.parse(line); } catch { continue; }
        const parsed = z.object({ type: z.string(), request_id: z.string().optional(),
          request: z.object({ subtype: z.string() }).optional(),
          response: z.object({ subtype: z.string(), request_id: z.string(), response: z.unknown().optional() }).optional(),
        }).safeParse(message);
        if (!parsed.success) continue;
        const m = parsed.data;
        if (m.type === 'control_request' && m.request_id) {
          if (m.request?.subtype === 'can_use_tool') child.stdin.write(JSON.stringify({ type: 'control_response', response: {
            subtype: 'success', request_id: m.request_id, response: { behavior: 'deny', message: 'Context reporting cannot execute tools.' },
          } }) + '\n');
          else return finish({ kind: 'unavailable', reason: 'Claude requested an unsupported diagnostic interaction.' });
        }
        if (m.type !== 'control_response' || !m.response) continue;
        if (m.response.subtype !== 'success') return finish({ kind: 'unavailable', reason: 'Claude context control request failed.' });
        switch (m.response.request_id) {
          case 'initialise': send('mcp-status', { subtype: 'mcp_status' }); break;
          case 'mcp-status': {
            const status = z.object({ mcpServers: z.array(z.object({ status: z.string() })).max(500) }).safeParse(m.response.response);
            if (!status.success) return finish({ kind: 'unavailable', reason: 'Claude returned unsupported MCP readiness data.' });
            const pending = status.data.mcpServers.some(server => !['connected', 'failed', 'disabled'].includes(server.status));
            if (pending && Date.now() - started < 3000) poll = setTimeout(() => send('mcp-status', { subtype: 'mcp_status' }), 100);
            else {
              if (pending || status.data.mcpServers.some(server => server.status === 'failed')) readiness.push('Some MCP servers were not ready; their definitions may be missing.');
              send('summary', { subtype: 'get_context_usage', detail: 'summary' });
            }
            break;
          }
          case 'summary': finish(projectReport(m.response.response, input.sessionId, readiness)); break;
        }
        if (settled) break;
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else send('initialise', { subtype: 'initialize', hooks: {} });
  });
}
