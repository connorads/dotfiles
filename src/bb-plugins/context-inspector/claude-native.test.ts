import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { collectClaude } from './claude-native';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
const sessionId = '00000000-0000-4000-8000-000000000001';
const input = { sessionId, cwd: '/synthetic/project' };
const report = {
  model: 'synthetic-model', totalTokens: 1237,
  categories: [{ id: 'messages', name: 'Messages', kind: 'used', tokens: 1237 },
    { id: 'compact', name: 'Unfamiliar reserve label', kind: 'buffer', tokens: 33000 }],
  messageBreakdown: { userMessageTokens: 260, assistantMessageTokens: 378, toolCallTokens: 26, toolResultTokens: 617 },
};
function processFixture(reply: (request: Record<string, unknown>, respond: (payload: unknown) => void) => void) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  child.kill.mockImplementation(() => { queueMicrotask(() => child.emit('close', 0)); return true; });
  const requests: Record<string, unknown>[] = [];
  child.stdin.on('data', chunk => {
    for (const line of String(chunk).trim().split('\n')) {
      const message = JSON.parse(line);
      requests.push(message);
      queueMicrotask(() => reply(message, payload => child.stdout.write(JSON.stringify(payload) + '\n')));
    }
  });
  mocks.spawn.mockReturnValue(child);
  return { child, requests };
}
function response(request: Record<string, unknown>, payload: unknown) {
  return { type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: payload } };
}
function normalReply(message: Record<string, unknown>, respond: (payload: unknown) => void) {
  const r = message.request as { subtype: string };
  respond(response(message, r.subtype === 'get_context_usage' ? report : r.subtype === 'mcp_status' ? { mcpServers: [] } : {}));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); mocks.spawn.mockReset(); });
test('requests only native summary controls in a non-persisted fork and terminates it', async () => {
  const f = processFixture(normalReply);
  const result = await collectClaude({ ...input, configDir: '/synthetic/account' });
  expect(result.kind).toBe('available');
  expect(f.requests.map(m => (m.request as { subtype: string }).subtype)).toEqual(['initialize', 'mcp_status', 'get_context_usage']);
  expect(f.requests.every(m => m.type === 'control_request')).toBe(true);
  expect(f.requests.at(-1)?.request).toEqual({ subtype: 'get_context_usage', detail: 'summary' });
  const [command, args, options] = mocks.spawn.mock.calls[0];
  expect(command).toBe('claude');
  expect(args).toEqual(expect.arrayContaining(['--resume', sessionId, '--fork-session', '--no-session-persistence']));
  expect(args).not.toContain('--safe-mode'); expect(args).not.toContain('--bare');
  expect(options.cwd).toBe(input.cwd); expect(options.env.CLAUDE_CONFIG_DIR).toBe('/synthetic/account');
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
});
test('preserves child estimates above parent and uses native buffer kind', async () => {
  processFixture(normalReply);
  const result = await collectClaude(input);
  if (result.kind !== 'available') throw new Error('Expected native report');
  expect(result.categories[0].entries.reduce((n, e) => n + e.tokens, 0)).toBe(1281);
  expect(result.categories[0].tokens).toBe(1237);
  expect(result.categories[1].kind).toBe('reserved');
  expect(result.notes.join(' ')).toMatch(/BB-injected/);
});
test('invalid native counts return an opaque error without copying raw output', async () => {
  processFixture((m, send) => {
    if ((m.request as { subtype: string }).subtype === 'get_context_usage') send(response(m, { ...report, totalTokens: -1, private: 'never copy this' }));
    else normalReply(m, send);
  });
  const result = await collectClaude(input);
  expect(result).toEqual({ kind: 'unavailable', reason: 'Claude returned an unsupported context report.' });
});
test('denies unexpected tool requests without sending a prompt', async () => {
  const f = processFixture((m, send) => {
    if ((m.request as { subtype?: string } | undefined)?.subtype === 'initialize') send({ type: 'control_request', request_id: 'tool-attempt', request: { subtype: 'can_use_tool', tool_name: 'Read' } });
    if (m.type === 'control_request') normalReply(m, send);
  });
  await collectClaude(input);
  expect(f.requests).toContainEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'tool-attempt', response: { behavior: 'deny', message: 'Context reporting cannot execute tools.' } } });
});
test('refuses an already cancelled request without starting a process', async () => {
  const abort = new AbortController(); abort.abort();
  expect((await collectClaude(input, abort.signal)).kind).toBe('unavailable');
  expect(mocks.spawn).not.toHaveBeenCalled();
});
test('abort terminates an outstanding reporter', async () => {
  const f = processFixture(() => {}); const abort = new AbortController();
  const result = collectClaude(input, abort.signal); abort.abort();
  expect(await result).toEqual({ kind: 'unavailable', reason: 'Claude context request cancelled.' });
  expect(f.child.kill).toHaveBeenCalled();
});
test('stdout bound closes a noisy reporter without returning its contents', async () => {
  const f = processFixture(() => {});
  const pending = collectClaude(input);
  f.child.stdout.write('x'.repeat(1024 * 1024 + 1));
  expect(await pending).toEqual({ kind: 'unavailable', reason: 'Claude context response exceeded its size limit.' });
});
test('native control errors are not silently retried as full token counts', async () => {
  const f = processFixture((m, send) => send({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'private native error' } }));
  expect(await collectClaude(input)).toEqual({ kind: 'unavailable', reason: 'Claude context control request failed.' });
  expect(f.requests).toHaveLength(1);
});
test('a stalled reporter times out and is terminated', async () => {
  vi.useFakeTimers(); const f = processFixture(() => {});
  const pending = collectClaude(input);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual({ kind: 'unavailable', reason: 'Claude context request timed out.' });
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
});
test('MCP source rows remain included when no deferred category exists', async () => {
  processFixture((m, send) => {
    if ((m.request as { subtype: string }).subtype === 'get_context_usage') send(response(m, {
      ...report, categories: [{ id: 'mcp_tools', name: 'MCP tools', kind: 'used', tokens: 845 }],
      mcpTools: [{ name: 'lookup', serverName: 'synthetic-server', tokens: 845, isLoaded: false }],
    })); else normalReply(m, send);
  });
  const result = await collectClaude(input);
  if (result.kind !== 'available') throw new Error('Expected native report');
  expect(result.categories[0].entries).toEqual([{ id: 'mcp_tools:0', label: 'synthetic-server: lookup', tokens: 845 }]);
});
test('pending MCP readiness is polled before requesting the summary', async () => {
  vi.useFakeTimers(); let statuses = 0;
  const f = processFixture((m, send) => {
    if ((m.request as { subtype: string }).subtype === 'mcp_status') send(response(m, { mcpServers: [{ status: statuses++ ? 'connected' : 'pending' }] }));
    else normalReply(m, send);
  });
  const pending = collectClaude(input);
  await vi.advanceTimersByTimeAsync(101);
  expect((await pending).kind).toBe('available');
  expect(f.requests.map(m => (m.request as { subtype: string }).subtype)).toEqual(['initialize', 'mcp_status', 'mcp_status', 'get_context_usage']);
});
test('startup errors do not expose process output', async () => {
  const f = processFixture(() => {}); const pending = collectClaude(input);
  f.child.emit('error', new Error('private path'));
  expect(await pending).toEqual({ kind: 'unavailable', reason: 'Claude executable could not be started.' });
});
test('does not reuse inherited account or credential overrides for the target', async () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', '/synthetic/unrelated-account');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-key');
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'synthetic-token');
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-oauth');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://synthetic.invalid');
  processFixture(normalReply); await collectClaude(input);
  const env = mocks.spawn.mock.calls[0][2].env;
  for (const key of ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL']) expect(env[key]).toBeUndefined();
});
test('an already closed child is not signalled again', async () => {
  const f = processFixture(() => {}); const pending = collectClaude(input);
  f.child.emit('close', 1);
  expect((await pending).kind).toBe('unavailable');
  expect(f.child.kill).not.toHaveBeenCalled();
});
