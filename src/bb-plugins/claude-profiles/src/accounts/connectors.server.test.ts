import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { registerConnectors } from './connectors.ts';

function setup() {
  const threads = new Map(['t1', 't2'].map(id => [id, makeThreadResponse({ id, providerId: 'claude-code', status: 'idle', environmentId: 'e1' })]));
  const events = new Map<string, unknown[]>();
  const stops: string[] = [];
  let stopError = false;
  let retainedActive = false;
  const { bb, harness } = createFakePluginHost({ sdk: {
    threads: {
      get: async ({ threadId }: { threadId: string }) => threads.get(threadId) ?? makeThreadResponse({ id: threadId, providerId: 'claude-code', environmentId: 'e1' }),
      list: async ({ offset = 0 }: { offset?: number }) => offset ? [] : [...threads.values()].filter(thread => !thread.archivedAt),
      stop: async ({ threadId }: { threadId: string }) => { if (stopError) throw new Error('Stop failed'); stops.push(threadId); const thread = threads.get(threadId);
        if (thread && !retainedActive) threads.set(threadId, { ...thread, status: 'idle' });
        return threads.get(threadId); },
      events: { list: async ({ threadId }: { threadId: string }) => events.get(threadId) ?? [] },
    },
    environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) },
  } as never });
  const switching = new Set<string>();
  const connectors = registerConnectors(bb, switching, async (threadId, profileId) => ({
    hostId: 'h1', profileId: profileId ?? (await bb.storage.kv.get<{profile: {id: string}}>(`thread:${threadId}`))?.profile.id ?? 'default',
  }));
  const rpc = (method: string, input: unknown) => harness.behavior.callRpc(method, input);
  return { bb, connectors, stops, threads, switching, rpc,
    failStop: () => { stopError = true; },
    retainActive: () => { retainedActive = true; },
    launched: (threadId: string, enabled: boolean, seq = 2) => events.set(threadId, [{ type: 'provider.env-resolved', seq, threadId,
      data: { entries: [{ name: 'ENABLE_CLAUDEAI_MCP_SERVERS', value: String(enabled), source: { pluginId: 'claude-profiles' } }] } }]),
    env: async (threadId = 't1', hostId = 'h1') => (await connectors.env(threadId, hostId))[0]?.value,
    account: (profileId: string, enabled: boolean) => rpc('connectors.account.set', { threadId: 't1', profileId, enabled }),
  };
}

test('global, account and thread controls combine without a thread override granting access', async () => {
  const { rpc, env, account } = setup();
  assert.equal(await env(), 'false');
  await account('default', true);
  assert.equal(await env(), 'true');
  await rpc('connectors.set', { threadId: 't1', mode: 'off' });
  assert.equal(await env(), 'false');
  await rpc('connectors.set', { threadId: 't1', mode: 'account' });
  await rpc('connectors.global.set', { blocked: true });
  assert.equal(await env(), 'false');
  await account('default', true);
  assert.equal(await env(), 'false');
  await rpc('connectors.global.set', { blocked: false });
  assert.equal(await env(), 'true');
});

test('switching accounts recalculates access and another host starts off', async () => {
  const { bb, env, account } = setup();
  await account('default', true);
  assert.equal(await env(), 'true');
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: { id: 'other' } });
  assert.equal(await env(), 'false');
  await account('other', true);
  assert.equal(await env(), 'true');
  assert.equal(await env('t1', 'h2'), 'false');
});

test('old off choices remain off and old on choices cannot enable an account', async () => {
  const { bb, env, account } = setup();
  await bb.storage.kv.set('connectors:t1', { enabled: true, afterSeq: 0 });
  await bb.storage.kv.set('connectors:t2', { enabled: false, afterSeq: 0 });
  assert.equal(await env(), 'false');
  await account('default', true);
  assert.equal(await env(), 'true');
  assert.equal(await env('t2'), 'false');
});

test('policy changes restart idle sessions and leave active sessions explicitly pending', async () => {
  const { threads, account, connectors, stops, launched } = setup();
  threads.set('t2', makeThreadResponse({ id: 't2', providerId: 'claude-code', environmentId: 'e1', status: 'active' }));
  launched('t1', false); launched('t2', false);
  await account('default', true);
  assert.deepEqual(stops, ['t1']);
  assert.equal((await connectors.state('t2')).pending, 1);
  assert.equal((await connectors.state('t2')).launch, 'off');
  threads.set('t2', makeThreadResponse({ id: 't2', providerId: 'claude-code', environmentId: 'e1', status: 'idle' }));
  await connectors.settle('t2');
  assert.deepEqual(stops, ['t1', 't2']);
  assert.equal((await connectors.state('t2')).pending, 0);
  assert.equal((await connectors.state('t2')).launch, 'pending');
  launched('t2', true, 3);
  assert.equal((await connectors.state('t2')).launch, 'on');
});

test('stop failures stay pending and an explicit action stops active sessions', async () => {
  const failed = setup();
  failed.failStop();
  await failed.account('default', true);
  assert.equal((await failed.connectors.state('t1')).pending, 2);
  await assert.rejects(failed.connectors.beforeDispatch('t1'), /Stop failed/);
  const active = setup();
  active.threads.set('t1', makeThreadResponse({ id: 't1', providerId: 'claude-code', environmentId: 'e1', status: 'active' }));
  await active.account('default', true);
  await active.rpc('connectors.restart', {});
  assert.ok(active.stops.includes('t1'));
  assert.equal((await active.connectors.state('t1')).pending, 0);
});

test('global block stops an old process whose launch disagrees with its stored policy', async () => {
  const { connectors, launched, rpc, stops } = setup();
  launched('t1', true);
  await rpc('connectors.global.set', { blocked: true });
  assert.ok(stops.includes('t1'));
  assert.equal((await connectors.state('t1')).enabled, false);
});

test('forks copy the thread restriction and children start off', async () => {
  const { connectors, account, rpc, env } = setup();
  await account('default', true);
  await connectors.claim({ id: 'child', originKind: null, sourceThreadId: null }, 't1');
  await connectors.claim({ id: 'fork', originKind: 'fork', sourceThreadId: 't1' }, null);
  assert.equal(await env('child'), 'false');
  assert.equal(await env('fork'), 'true');
  await rpc('connectors.set', { threadId: 't1', mode: 'off' });
  assert.equal(await env('fork'), 'true');
});

test('draft account settings apply to subsequent threads without a consumable choice', async () => {
  const { account, connectors, env } = setup();
  await account('default', true);
  assert.equal((await connectors.state(null)).enabled, true);
  assert.equal(await env('new1'), 'true');
  assert.equal(await env('new2'), 'true');
});

test('automatic restarts preserve queued turns and account switches reject policy edits', async () => {
  const { connectors, account, threads, switching, env } = setup();
  for (const id of ['t1', 't2']) threads.set(id, makeThreadResponse({ id, providerId: 'claude-code', environmentId: 'e1', status: 'active', queuedMessageCount: 1 }));
  await account('default', true);
  assert.equal((await connectors.state('t1')).pending, 2);
  threads.set('t1', makeThreadResponse({ id: 't1', providerId: 'claude-code', environmentId: 'e1', status: 'idle', queuedMessageCount: 1 }));
  await connectors.beforeDispatch('t1');
  assert.equal((await connectors.state('t1')).pending, 1);
  threads.set('t2', makeThreadResponse({ id: 't2', providerId: 'claude-code', environmentId: 'e1', status: 'idle', queuedMessageCount: 1 }));
  await connectors.settle('t2');
  assert.equal((await connectors.state('t1')).pending, 0);
  assert.equal(threads.get('t1')?.queuedMessageCount, 1);
  assert.equal(threads.get('t2')?.queuedMessageCount, 1);
  switching.add('t2');
  await assert.rejects(account('default', false), /changing/);
  assert.equal(await env(), 'true');
});

test('before dispatch reconciles an old launch with the migrated account policy', async () => {
  const { bb, launched, connectors, stops } = setup();
  await bb.storage.kv.set('connectors:t1', { enabled: true, afterSeq: 0 });
  launched('t1', true);
  await connectors.beforeDispatch('t1');
  assert.deepEqual(stops, ['t1']);
  await connectors.beforeDispatch('t1');
  assert.deepEqual(stops, ['t1']);
});

test('an account change leaves other accounts and other providers running', async () => {
  const { bb, threads, account, stops } = setup();
  await bb.storage.kv.set('thread:t2', { hostId: 'h1', profile: { id: 'other' } });
  threads.set('t3', makeThreadResponse({ id: 't3', providerId: 'codex', status: 'idle', environmentId: 'e1' }));
  await account('default', true);
  assert.deepEqual(stops, ['t1']);
});

test('deleted and archived threads stop contributing to the pending count', async () => {
  const { threads, account, connectors, launched, stops } = setup();
  launched('t2', false);
  for (const id of ['t1', 't2']) threads.set(id, makeThreadResponse({ id, providerId: 'claude-code', environmentId: 'e1', status: 'active' }));
  await account('default', true);
  assert.equal((await connectors.state('t1')).pending, 2);
  threads.delete('t1');
  threads.set('t2', makeThreadResponse({ id: 't2', providerId: 'claude-code', environmentId: 'e1', status: 'idle', archivedAt: 1 }));
  assert.equal((await connectors.state(null)).pending, 0);
  threads.set('t2', makeThreadResponse({ id: 't2', providerId: 'claude-code', environmentId: 'e1', status: 'idle' }));
  await connectors.beforeDispatch('t2');
  assert.ok(stops.includes('t2'));
});

test('a stop which retains an active turn cannot clear the pending restart', async () => {
  const { threads, account, connectors, retainActive, rpc } = setup();
  threads.set('t1', makeThreadResponse({ id: 't1', providerId: 'claude-code', environmentId: 'e1', status: 'active' }));
  await account('default', true);
  retainActive();
  await rpc('connectors.restart', {});
  assert.equal((await connectors.state('t1')).pending, 1);
});
