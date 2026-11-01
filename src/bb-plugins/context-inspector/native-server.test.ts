import { afterEach, expect, test } from 'vitest';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from './server';

const sessionId = '00000000-0000-4000-8000-000000000001';
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
function setup(providerId = 'codex') {
  const state = { revision: 1, status: 'idle', cleared: false, entries: [] as { name: string; value: string | { masked: true }; source: 'shell' }[] };
  const calls: { method: string; input: unknown; hostId: string }[] = [];
  const sequence: string[] = [];
  let mutate = false;
  const fixture = createFakePluginHost({ pluginId: 'context-inspector', sdk: {
    threads: {
      get: () => ({ id: 'thread-synthetic', environmentId: 'env-synthetic', providerId, status: state.status, activeBackgroundAgentCount: 0, queuedMessageCount: 0 }),
      stop: () => { sequence.push('stop'); return {}; },
      events: { list: ({ types }) => {
        if (types?.[0] === 'provider.env-resolved') return [{ type: 'provider.env-resolved', seq: 1, data: { providerThreadId: sessionId, entries: state.entries } }];
        return [{ type: state.cleared ? 'thread/context/cleared' : 'thread/identity', seq: state.revision, data: { providerThreadId: sessionId } }];
      } },
    }, environments: { get: () => ({ id: 'env-synthetic', hostId: 'host-execution', path: '/synthetic/workspace' }) },
  }, experimental_callHostRpc: async ({ method, input, hostId }) => {
    calls.push({ method, input, hostId }); sequence.push(method);
    if (method === 'traceRoot') return { path: '/synthetic/private/thread-synthetic' };
    if (method === 'purge') return { purged: true };
    if (mutate) state.revision++;
    return { kind: 'available', provider: providerId, scope: providerId === 'codex' ? 'last-request' : 'saved-session', capturedAt: '2026-01-01T00:00:00Z', providerSessionId: sessionId, requestId: null, method: 'Synthetic estimate', totalTokens: 10, categories: [], notes: [] };
  } });
  hosts.push(fixture); plugin(fixture.bb);
  return { ...fixture, state, calls, sequence, race: () => { mutate = true; } };
}
test('recording is off by default and contributes only to the selected execution host', async () => {
  const f = setup();
  const target = { threadId: 'thread-synthetic', projectId: 'project-synthetic', hostId: 'host-execution' };
  expect(await f.harness.behavior.resolveProviderEnv('codex', target)).toEqual([]);
  expect(f.calls).toHaveLength(0);
  await f.harness.behavior.callRpc('tracing', { threadId: target.threadId, enabled: true });
  expect(await f.harness.behavior.resolveProviderEnv('codex', target)).toMatchObject([{ name: 'CODEX_ROLLOUT_TRACE_ROOT', value: '/synthetic/private/thread-synthetic' }]);
  expect(f.calls[0]).toMatchObject({ method: 'traceRoot', hostId: target.hostId, input: { threadId: target.threadId } });
  await f.harness.behavior.callRpc('tracing', { threadId: target.threadId, enabled: false });
  expect(await f.harness.behavior.resolveProviderEnv('codex', target)).toEqual([]);
});
test('native request uses the exact identity on the execution host', async () => {
  const f = setup();
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'available' } });
  expect(f.calls).toEqual([{ method: 'codex', hostId: 'host-execution', input: { threadId: 'thread-synthetic', sessionId } }]);
});
test('a context clear refuses old session attachment', async () => {
  const f = setup(); f.state.cleared = true;
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'unavailable', reason: expect.stringContaining('identity') } });
  expect(f.calls).toHaveLength(0);
});
test('a lifecycle change discards a diagnostic result', async () => {
  const f = setup(); f.race();
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'unavailable', reason: expect.stringContaining('changed') } });
});
test('opening Claude does not launch a diagnostic and active turns refuse a manual read', async () => {
  const f = setup('claude-code');
  await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: false });
  f.state.status = 'active';
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'unavailable', reason: expect.stringContaining('Finish') } });
  expect(f.calls).toHaveLength(0);
});
test('Claude account metadata is forwarded without credential data', async () => {
  const f = setup('claude-code');
  f.state.entries = [{ name: 'CLAUDE_CONFIG_DIR', value: '/synthetic/account', source: 'shell' }];
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'available' } });
  expect(f.calls[0]).toMatchObject({ method: 'claude', hostId: 'host-execution', input: { sessionId, cwd: '/synthetic/workspace', configDir: '/synthetic/account' } });
});
test('custom Claude credential delivery refuses an unrelated account', async () => {
  const f = setup('claude-code');
  f.state.entries = [{ name: 'ANTHROPIC_API_KEY', value: { masked: true }, source: 'shell' }];
  expect(await f.harness.behavior.callRpc('native', { threadId: 'thread-synthetic', collect: true })).toMatchObject({ report: { kind: 'unavailable', reason: expect.stringContaining('custom') } });
  expect(f.calls).toHaveLength(0);
});
test('trace deletion refuses running work and never stops a runtime', async () => {
  const f = setup(); f.state.status = 'active';
  await expect(f.harness.behavior.callRpc('purge', { threadId: 'thread-synthetic' })).rejects.toThrow('Finish');
  expect(f.sequence).toEqual([]);
  f.state.status = 'idle';
  expect(await f.harness.behavior.callRpc('purge', { threadId: 'thread-synthetic' })).toEqual({ purged: true });
  expect(f.sequence).toEqual(['purge']);
});
