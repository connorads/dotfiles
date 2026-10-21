import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

const variable = 'ENABLE_CLAUDEAI_MCP_SERVERS';
function setup() {
  let thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'idle', environmentId: 'e1' });
  let events: unknown[] = [];
  let stopError = false;
  let lookup: 'ok' | 'failure' | 'stalled' = 'ok';
  const { bb, harness } = createFakePluginHost({ sdk: {
    threads: {
      get: async ({ threadId }: { threadId: string }) => {
        if (lookup === 'failure') throw new Error('Thread lookup failed');
        if (lookup === 'stalled') return new Promise(() => {});
        return threadId === 'native-fork'
          ? { ...thread, id: threadId, originKind: 'fork', sourceThreadId: 't1' } : thread;
      },
      stop: async () => { if (stopError) throw new Error('Could not stop session'); return thread; },
      events: { list: async () => events },
    },
    environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) },
  } as never });
  plugin(bb);
  return { bb, harness,
    running() { thread = { ...thread, status: 'active' }; },
    failStop() { stopError = true; },
    failLookup: (mode: 'failure' | 'stalled') => { lookup = mode; },
    launched: (enabled: boolean, seq = 2) => { events = [{ type: 'provider.env-resolved', seq, threadId: 't1',
      data: { entries: [{ name: variable, value: String(enabled), source: { pluginId: 'claude-profiles' } }] } }]; },
    env: () => harness.behavior.resolveProviderEnv('claude-code', { threadId: 't1', hostId: 'h1', projectId: 'p1' }),
  };
}

test('account connectors default off without affecting the account environment', async () => {
  const { harness, env } = setup();
  assert.deepEqual(await harness.behavior.callRpc('connectors.get', { threadId: 't1' }), { enabled: false, launch: 'pending' });
  assert.deepEqual(await env(), [{ name: variable, value: 'false', reason: 'Claude account connectors' }]);
});

test('an idle toggle stops the old session and reports pending until a new launch', async () => {
  const { harness, env, launched } = setup();
  launched(false);
  assert.deepEqual(await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true }), { enabled: true, launch: 'pending' });
  assert.equal(harness.inspection.sdk.callsTo('threads.stop').length, 1);
  assert.equal((await env()).find(entry => entry.name === variable)?.value, 'true');
  launched(true, 3);
  assert.deepEqual(await harness.behavior.callRpc('connectors.get', { threadId: 't1' }), { enabled: true, launch: 'on' });
  assert.deepEqual(await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: false }), { enabled: false, launch: 'pending' });
  assert.equal((await env()).find(entry => entry.name === variable)?.value, 'false');
});

test('running turns and a failed stop cannot change connector access', async () => {
  const busy = setup();
  busy.running();
  await assert.rejects(busy.harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true }), /Finish or stop/);
  assert.equal((await busy.env())[0]?.value, 'false');
  const failure = setup();
  failure.failStop();
  await assert.rejects(failure.harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true }), /Could not stop/);
  assert.equal((await failure.env())[0]?.value, 'false');
});

test('a different account keeps the thread connector choice', async () => {
  const { bb, harness, env } = setup();
  await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true });
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'other', label: 'Other', configDir: '/profiles/other' } });
  const entries = await env();
  assert.equal(entries.find(entry => entry.name === variable)?.value, 'true');
  assert.equal(entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR')?.value, '/profiles/other');
});

test('forks inherit connector access, and a later source toggle does not change the fork', async () => {
  const { harness } = setup();
  await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  assert.ok(hook);
  await hook(makeMessageDispatchHookContext({ thread: { id: 'fork1', providerId: 'claude-code', status: 'pending',
    originKind: 'fork', sourceThreadId: 't1' }, host: { id: 'h1' } }));
  assert.equal((await harness.behavior.resolveProviderEnv('claude-code', { threadId: 'fork1', projectId: 'p1', hostId: 'h1' }))
    .find(entry => entry.name === variable)?.value, 'true');
  await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: false });
  assert.equal((await harness.behavior.resolveProviderEnv('claude-code', { threadId: 'fork1', projectId: 'p1', hostId: 'h1' }))
    .find(entry => entry.name === variable)?.value, 'true');
});

test('the native fork launch inherits before the first message dispatch', async () => {
  const { harness } = setup();
  await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true });
  const entries = await harness.behavior.resolveProviderEnv('claude-code', { threadId: 'native-fork', projectId: 'p1', hostId: 'h1' });
  assert.equal(entries.find(entry => entry.name === variable)?.value, 'true');
});

test('drafts cannot enable connectors for an unrelated new thread', async () => {
  const { harness } = setup();
  await assert.rejects(harness.behavior.callRpc('connectors.set', { threadId: null, enabled: true }));
  assert.deepEqual(await harness.behavior.callRpc('connectors.get', { threadId: null }), { enabled: false, launch: 'pending' });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  assert.ok(hook);
  await hook(makeMessageDispatchHookContext({ thread: { id: 'new1', providerId: 'claude-code', status: 'pending' }, host: { id: 'h1' } }));
  assert.deepEqual(await harness.behavior.callRpc('connectors.get', { threadId: 'new1' }), { enabled: false, launch: 'pending' });
});

test('agent-spawned children start off even when their parent enables connectors', async () => {
  const { harness } = setup();
  await harness.behavior.callRpc('connectors.set', { threadId: 't1', enabled: true });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  assert.ok(hook);
  await hook(makeMessageDispatchHookContext({ thread: { id: 'child1', providerId: 'claude-code', status: 'pending' },
    parentThreadId: 't1', host: { id: 'h1' } }));
  assert.deepEqual(await harness.behavior.callRpc('connectors.get', { threadId: 'child1' }), { enabled: false, launch: 'pending' });
});

for (const mode of ['failure', 'stalled'] as const) {
  test(`a ${mode} connector lookup preserves the selected account environment`, async () => {
    const { bb, env, failLookup } = setup();
    await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'other', label: 'Other', configDir: '/profiles/other' } });
    failLookup(mode);
    const entries = await env();
    assert.equal(entries.find(entry => entry.name === 'CLAUDE_CONFIG_DIR')?.value, '/profiles/other');
    assert.equal(entries.find(entry => entry.name === variable), undefined);
  });
}
