import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

const summit = { id: 'summit', label: 'Summit', configDir: '/profiles/summit' };
const trove = { id: 'trove', label: 'Trove', configDir: '/profiles/trove' };

async function setup(options: { transfer?: () => Promise<void>; turnOpen?: () => boolean } = {}) {
  const thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'active', environmentId: 'e1', queuedMessageCount: 0 });
  const stops: unknown[] = [];
  const transfers: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: {
        get: async () => ({ ...thread }),
        stop: async () => { stops.push(thread.id); return thread; },
        events: { list: async (args: { types: string[] }) => args.types.includes('turn/started')
          ? [{ type: options.turnOpen?.() ? 'turn/started' : 'turn/completed', seq: 9, threadId: 't1', data: {} }]
          : args.types.includes('thread/identity')
          ? [{ type: 'thread/identity', seq: 3, threadId: 't1', data: { providerThreadId: 'session-1' } }]
          : [{ type: 'provider.env-resolved', seq: 7, threadId: 't1', data: { entries: [
            { name: 'CLAUDE_CONFIG_DIR', source: { plugin: 'claude-profiles' }, value: summit.configDir },
            { name: 'ENABLE_CLAUDEAI_MCP_SERVERS', source: { plugin: 'claude-profiles' }, value: 'false' }] } }] },
      },
      environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) },
      hosts: { list: async () => [{ id: 'h1', status: 'connected' }] },
      plugins: { list: async () => [] },
    } as never,
    experimental_callHostRpc: async call => {
      if (call.method === 'profiles') return [{ id: 'default', label: 'Default', configDir: null }, summit, trove];
      if (call.method === 'validate') return { authenticated: true };
      if (call.method === 'transfer') { transfers.push(call.input); await options.transfer?.(); return { copied: true }; }
      if (call.method === 'materialise') return { materialised: true };
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile: summit });
  await bb.storage.kv.set('guard:t1', { checkedSeq: 7, notice: null });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  if (!hook) throw new Error('Missing dispatch hook.');
  const dispatch = (attempt: 'start-turn' | 'join-turn') => hook(makeMessageDispatchHookContext({
    thread: { id: 't1', providerId: 'claude-code', status: thread.status }, host: { id: 'h1' }, attempt }));
  const bound = async () => (await bb.storage.kv.get<{ profile: { id: string } }>('thread:t1'))?.profile.id;
  const finishTurn = async (queued = 0) => {
    thread.status = 'idle'; thread.queuedMessageCount = queued;
    await harness.behavior.emitThreadEvent('experimental_thread.events', { thread: { ...thread }, sequence: 8 });
  };
  return { harness, thread, stops, transfers, dispatch, bound, finishTurn };
}

test('choosing an account mid-turn queues it instead of refusing', async () => {
  const { harness, transfers, bound } = await setup();
  const result = await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  assert.deepEqual(result, { currentId: 'summit' });
  const accounts = await harness.behavior.callRpc('accounts', { threadId: 't1' }) as { currentId: string; pendingId: string | null };
  assert.deepEqual([accounts.currentId, accounts.pendingId], ['summit', 'trove']);
  assert.equal(transfers.length, 0);
  assert.equal(await bound(), 'summit');
});

test('a steer into the running turn stays on the old account', async () => {
  const { harness, dispatch, transfers } = await setup();
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  assert.deepEqual(await dispatch('join-turn'), { action: 'proceed' });
  assert.equal(transfers.length, 0);
});

test('the switch runs when the turn ends, then the next turn proceeds on the new account', async () => {
  const { harness, dispatch, transfers, bound, finishTurn } = await setup();
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  await finishTurn();
  assert.equal(transfers.length, 1);
  assert.equal(await bound(), 'trove');
  assert.ok(harness.inspection.recheckCount >= 1);
  assert.deepEqual(await dispatch('start-turn'), { action: 'proceed' });
});

test('a queued message dispatched before the switch finishes waits, without holding the hook', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { harness, dispatch, transfers, bound, thread } = await setup({ transfer: () => gate });
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  thread.status = 'idle'; thread.queuedMessageCount = 1;
  const decision = await dispatch('start-turn');
  assert.equal(decision.action, 'wait');
  assert.match(decision.action === 'wait' ? decision.reason : '', /Moving to Trove/);
  // The hook answered while the transfer is still blocked.
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(transfers.length, 1);
  assert.equal(await bound(), 'summit');
  assert.equal((await dispatch('start-turn')).action, 'wait');
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await bound(), 'trove');
  assert.ok(harness.inspection.recheckCount >= 1);
  assert.deepEqual(await dispatch('start-turn'), { action: 'proceed' });
});

test('a failed switch refuses the next turn once with the reason and keeps the old account', async () => {
  const { harness, dispatch, bound, finishTurn } = await setup({ transfer: async () => { throw new Error('conflicting history'); } });
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  await finishTurn();
  assert.equal(await bound(), 'summit');
  const refused = await dispatch('start-turn');
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /Could not move to Trove: conflicting history/);
  assert.deepEqual(await dispatch('start-turn'), { action: 'proceed' });
});

test('an idle thread still switches immediately', async () => {
  const { harness, thread, transfers, bound } = await setup();
  thread.status = 'idle';
  assert.deepEqual(await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' }), { currentId: 'trove' });
  assert.equal(transfers.length, 1);
  assert.equal(await bound(), 'trove');
});

test('choosing the current account again cancels a pending switch', async () => {
  const { harness, dispatch, transfers, finishTurn } = await setup();
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'summit' });
  const accounts = await harness.behavior.callRpc('accounts', { threadId: 't1' }) as { pendingId: string | null };
  assert.equal(accounts.pendingId, null);
  await finishTurn();
  assert.equal(transfers.length, 0);
  assert.deepEqual(await dispatch('start-turn'), { action: 'proceed' });
});

test('a pending account must exist on the thread machine', async () => {
  const { harness } = await setup();
  await assert.rejects(harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'missing' }), /Profile does not exist/);
});

test('a send during a manual switch waits instead of failing', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { harness, thread, dispatch } = await setup({ transfer: () => gate });
  thread.status = 'idle';
  const switching = harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' });
  await new Promise(resolve => setTimeout(resolve, 5));
  const decision = await dispatch('start-turn');
  assert.equal(decision.action, 'wait');
  release();
  await switching;
  assert.deepEqual(await dispatch('start-turn'), { action: 'proceed' });
});

test('a turn that has started while BB still reports idle queues the switch instead of stopping the turn', async () => {
  let open = true;
  const { harness, thread, transfers, stops, bound, finishTurn } = await setup({ turnOpen: () => open });
  thread.status = 'idle';
  assert.deepEqual(await harness.behavior.callRpc('choose', { threadId: 't1', profileId: 'trove' }), { currentId: 'summit' });
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread: { ...thread }, sequence: 9 });
  assert.equal(transfers.length, 0);
  assert.equal(stops.length, 0);
  open = false;
  await finishTurn();
  assert.equal(transfers.length, 1);
  assert.equal(await bound(), 'trove');
});
