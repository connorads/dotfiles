import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../../server.ts';

const profile = { id: 'stretch', label: 'stretch', configDir: '/profiles/stretch' };

async function setup(launchEntries: { name: string; source: unknown; value: string }[]) {
  const thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'idle', environmentId: 'e1' });
  const stops: unknown[] = [];
  const { bb, harness } = createFakePluginHost({ sdk: { threads: {
    get: async () => thread,
    stop: async (args: unknown) => { stops.push(args); return thread; },
    events: { list: async () => [{ type: 'provider.env-resolved', seq: 7, threadId: 't1', data: { entries: launchEntries } }] },
  } } as never });
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile });
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  if (!hook) throw new Error('Missing dispatch hook.');
  const dispatch = (hostId = 'h1') => hook(makeMessageDispatchHookContext({
    thread: { id: 't1', providerId: 'claude-code', status: 'idle' }, host: { id: hostId } }));
  return { harness, thread, stops, dispatch };
}

test('a launch without the selected profile is stopped and the next send says why', async () => {
  const { harness, thread, stops, dispatch } = await setup([{ name: 'HOME', source: 'shell', value: '/Users/me' }]);
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 7 });
  assert.equal(stops.length, 1);
  const refused = await dispatch();
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /without the stretch account/);
  assert.deepEqual(await dispatch(), { action: 'proceed' });
  assert.equal(stops.length, 1);
});

test('a launch with the selected profile keeps running', async () => {
  const { harness, thread, stops, dispatch } = await setup([
    { name: 'CLAUDE_CONFIG_DIR', source: { plugin: 'claude-profiles' }, value: profile.configDir }]);
  await harness.behavior.emitThreadEvent('experimental_thread.events', { thread, sequence: 7 });
  assert.deepEqual(await dispatch(), { action: 'proceed' });
  assert.equal(stops.length, 0);
});

test('a send stops a bad launch that the event review has not seen yet', async () => {
  const { stops, dispatch } = await setup([]);
  assert.equal((await dispatch()).action, 'reject');
  assert.equal(stops.length, 1);
});

test('a send from another machine is refused before Claude starts on its native login', async () => {
  const { stops, dispatch } = await setup([
    { name: 'CLAUDE_CONFIG_DIR', source: { plugin: 'claude-profiles' }, value: profile.configDir }]);
  const refused = await dispatch('h2');
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /stretch account belongs to another machine/);
  assert.equal(stops.length, 0);
  assert.deepEqual(await dispatch('h1'), { action: 'proceed' });
});

async function usageSetup() {
  const thread = makeThreadResponse({ id: 't1', providerId: 'claude-code', status: 'idle', environmentId: 'e1' });
  const hostCalls: { method: string; input: unknown; hostId: string }[] = [];
  const quota = { status: 'ok', message: null, observedAt: Date.now(), windows: [
    { id: 'five_hour', label: 'Five hours', usedPercent: 12, resetsAt: null, cost: null },
    { id: 'seven_day', label: 'Seven days', usedPercent: 64, resetsAt: null, cost: null }] };
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => thread },
      environments: { get: async () => ({ id: 'e1', hostId: 'h1' }) },
      providers: { list: async () => [{ id: 'claude-code', displayName: 'Claude Code' }] },
      plugins: { callRpc: async (args: { pluginId: string }) => { throw new Error(`Unexpected RPC to ${args.pluginId}`); } },
    } as never,
    experimental_callHostRpc: call => {
      hostCalls.push(call);
      if (call.method === 'profiles') return [{ id: 'default', label: 'Default', configDir: null }, profile];
      if (call.method === 'usage') return quota;
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  await bb.storage.kv.set('thread:t1', { hostId: 'h1', profile });
  return { harness, hostCalls };
}

test('the usage header for a bound thread shows that profile\'s quota without calling another plugin', async () => {
  const { harness, hostCalls } = await usageSetup();
  assert.deepEqual(await harness.behavior.callRpc('usage.header', { threadId: 't1' }), {
    providerId: 'claude-code', label: 'Claude Code', accountLabel: 'stretch', message: null, windows: [
      { label: '5-hour', period: 'five-hour', usedPercent: 12, resetsAt: null, cost: null },
      { label: 'Weekly', period: 'week', usedPercent: 64, resetsAt: null, cost: null }] });
  assert.deepEqual(hostCalls.filter(call => call.method === 'usage').map(call => [call.hostId, (call.input as { profileId: string }).profileId]),
    [['h1', 'stretch']]);
});

test('the header and the usage RPC share one quota reading per minute', async () => {
  const { harness, hostCalls } = await usageSetup();
  await harness.behavior.callRpc('usage.header', { threadId: 't1' });
  await harness.behavior.callRpc('usage', { threadId: 't1', profileId: 'stretch', refresh: false });
  await harness.behavior.callRpc('usage.header', { threadId: 't1' });
  assert.equal(hostCalls.filter(call => call.method === 'usage').length, 1);
});

test('the header CLI prints a thread\'s usage', async () => {
  const { harness } = await usageSetup();
  const result = await harness.behavior.runCli(['header', 't1']);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).accountLabel, 'stretch');
  assert.equal((await harness.behavior.runCli(['overview', '--bogus'])).exitCode, 1);
});

const work = { id: 'work', label: 'Work', configDir: '/profiles/work' };
const personal = { id: 'personal', label: 'Personal', configDir: '/profiles/personal' };
type ThreadFields = { parentThreadId?: string | null; originKind?: 'fork' | null; sourceThreadId?: string | null; lifecycleOwnerThreadId?: string | null };

async function newThreadSetup(hostProfiles = [{ id: 'default', label: 'Default', configDir: null }, work, personal]) {
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: call => {
      if (call.method === 'profiles') return hostProfiles;
      throw new Error(`Unexpected host call ${call.method}`);
    },
  });
  plugin(bb);
  await bb.storage.kv.set('next-thread-profile', 'personal');
  const hook = harness.inspection.registrations.hooks['message.dispatch'];
  if (!hook) throw new Error('Missing dispatch hook.');
  const firstSend = ({ parentThreadId = null, ...thread }: ThreadFields = {}) => hook(makeMessageDispatchHookContext({
    thread: { id: 'child', providerId: 'claude-code', status: 'pending', parentThreadId, ...thread },
    host: { id: 'h1' }, parentThreadId }));
  const binding = () => bb.storage.kv.get<{ hostId: string; profile: { id: string } }>('thread:child');
  return { bb, firstSend, binding };
}

test('a child of a thread on a named account starts on that account, not the composer account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h2', profile: work });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.deepEqual(await binding(), { hostId: 'h1', profile: work });
});

test('a fork starts on its source thread\'s account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: work });
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'work');
});

test('a child of a thread switched to Default starts on Default, not the composer account', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.deepEqual(await binding(), { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
});

test('a fork of a thread switched to Default starts on Default', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:source', { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } });
  assert.deepEqual(await firstSend({ originKind: 'fork', sourceThreadId: 'source' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'default');
});

test('an inherited account missing on this machine refuses the send and binds nothing', async () => {
  const { bb, firstSend, binding } = await newThreadSetup([{ id: 'default', label: 'Default', configDir: null }, personal]);
  await bb.storage.kv.set('thread:parent', { hostId: 'h2', profile: work });
  const refused = await firstSend({ parentThreadId: 'parent' });
  assert.equal(refused.action, 'reject');
  assert.match(refused.action === 'reject' ? refused.message : '', /inherits the Work account.*does not exist on this machine/);
  assert.equal(await binding(), undefined);
});

test('a child of an unbound thread uses the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a thread with no parent uses the composer account', async () => {
  const { firstSend, binding } = await newThreadSetup();
  assert.deepEqual(await firstSend(), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a lifecycle owner alone is not a parent', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:owner', { hostId: 'h1', profile: work });
  await firstSend({ lifecycleOwnerThreadId: 'owner' });
  assert.equal((await binding())?.profile.id, 'personal');
});

test('a child that already has an account keeps it', async () => {
  const { bb, firstSend, binding } = await newThreadSetup();
  await bb.storage.kv.set('thread:parent', { hostId: 'h1', profile: work });
  await bb.storage.kv.set('thread:child', { hostId: 'h1', profile: personal });
  assert.deepEqual(await firstSend({ parentThreadId: 'parent' }), { action: 'proceed' });
  assert.equal((await binding())?.profile.id, 'personal');
});
