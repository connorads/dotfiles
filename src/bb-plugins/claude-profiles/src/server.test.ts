import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

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
  const dispatch = () => hook(makeMessageDispatchHookContext({ thread: { id: 't1', providerId: 'claude-code', status: 'idle' } }));
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
