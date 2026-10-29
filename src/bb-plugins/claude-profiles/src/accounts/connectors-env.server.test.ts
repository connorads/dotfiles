import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

for (const stalled of [false, true]) {
  test(`${stalled ? 'stalled' : 'failed'} connector lookup preserves account routing`, async () => {
    const { bb, harness } = createFakePluginHost({ sdk: { threads: {
      get: async () => { if (stalled) return new Promise(() => {}); throw new Error('Lookup failed'); },
    } } as never });
    plugin(bb);
    await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'other', label: 'Other', configDir: '/profiles/other' } });
    const entries = await harness.behavior.resolveProviderEnv('claude-code', { threadId: 't1', hostId: 'h1', projectId: 'p1' });
    assert.equal(entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR')?.value, '/profiles/other');
    assert.equal(entries.find(entry => entry.name === 'ENABLE_CLAUDEAI_MCP_SERVERS'), undefined);
  });
}

for (const fails of [false, true]) {
  test(`a profile launch materialises the profile on its host${fails ? ', and still routes when that fails' : ''}`, async () => {
    const calls: { method: string; input: unknown; hostId: string }[] = [];
    const { bb, harness } = createFakePluginHost({ sdk: { threads: { get: async () => { throw new Error('Lookup failed'); } } } as never,
      experimental_callHostRpc: async ({ method, input, hostId }) => {
        calls.push({ method, input, hostId });
        if (fails) throw new Error('Materialiser failed');
        return { materialised: true };
      } });
    plugin(bb);
    await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'other', label: 'Other', configDir: '/profiles/other' } });
    const entries = await harness.behavior.resolveProviderEnv('claude-code', { threadId: 't1', hostId: 'h1', projectId: 'p1' });
    assert.deepEqual(calls.filter(call => call.method === 'materialise'),
      [{ method: 'materialise', input: { root: '~/.claude-profiles/code', profileId: 'other' }, hostId: 'h1' }]);
    assert.equal(entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR')?.value, '/profiles/other');
  });
}

test('a Default launch does not materialise', async () => {
  const calls: string[] = [];
  const { bb, harness } = createFakePluginHost({ sdk: { threads: { get: async () => { throw new Error('Lookup failed'); } } } as never,
    experimental_callHostRpc: async ({ method }) => { calls.push(method); return {}; } });
  plugin(bb);
  await harness.behavior.resolveProviderEnv('claude-code', { threadId: 't1', hostId: 'h1', projectId: 'p1' });
  assert.deepEqual(calls.filter(method => method === 'materialise'), []);
});
