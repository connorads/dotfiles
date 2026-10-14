import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { rpcContract } from '../contracts.ts';

function setup(run: () => Promise<unknown> = async () => ({ ok: true, summary: 'Done' })) {
  let base = '/work';
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: 'env' }) },
      environments: { get: async () => ({ id: 'env', hostId: 'remote', path: base }) },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      assert.equal(hostId, 'remote');
      const args = input as { root: string; path?: string };
      if (method === 'select') return { root: `${args.root}/${args.path}` };
      if (method === 'watch') return { kind: 'none' };
      if (method === 'diff') return { patch: args.root, truncated: false };
      if (method === 'run') return run();
      return {};
    },
  });
  plugin(bb);
  const watch = (threadId = 't', clientId = 'a') => harness.behavior.callRpc('watch', { threadId, clientId });
  return { harness, watch, moveEnvironment: () => { base = '/other'; } };
}

test('selection routes reads to the chosen repo and migrates every window lease', async () => {
  const { harness, watch } = setup();
  try {
    await watch(); await watch('t', 'b'); await watch('other-thread', 'c');
    await harness.behavior.callRpc('select', { threadId: 't', path: 'app' });
    const state = rpcContract.watch.output.parse(await watch());
    assert.equal(state.root, '/work/app'); assert.equal(state.selected, true);
    assert.equal((await harness.behavior.callRpc('diff', { threadId: 't', path: 'x', origPath: null,
      source: { kind: 'work-tree', area: 'unstaged' } }) as { patch: string }).patch, '/work/app');
    assert.equal(rpcContract.watch.output.parse(await watch('other-thread', 'c')).root, '/work');
    await harness.behavior.callRpc('unwatch', { threadId: 't', clientId: 'a' });
    assert.equal(harness.experimental_hostRpcCalls.filter(call => call.method === 'unwatch').length, 0);
    await harness.behavior.callRpc('unwatch', { threadId: 't', clientId: 'b' });
    assert.deepEqual(harness.experimental_hostRpcCalls.filter(call => call.method === 'unwatch').map(call => call.input), [{ root: '/work/app' }]);
    await harness.behavior.callRpc('select', { threadId: 't', path: null });
    assert.equal(rpcContract.watch.output.parse(await watch()).selected, false);
    assert.equal(harness.inspection.sdk.callsTo('threads.update').length, 0);
  } finally { await harness.lifecycle.dispose(); }
});

test('stale actions fail and a new checkout ignores its previous selection', async () => {
  const { harness, watch, moveEnvironment } = setup();
  try {
    await watch();
    await harness.behavior.callRpc('select', { threadId: 't', path: 'app' });
    await assert.rejects(harness.behavior.callRpc('run', { threadId: 't', root: '/work', request: { kind: 'push' }, origin: 'user' }), /Repository changed/);
    assert.equal(harness.experimental_hostRpcCalls.filter(call => call.method === 'run').length, 0);
    moveEnvironment();
    assert.equal(rpcContract.watch.output.parse(await watch()).root, '/other');
  } finally { await harness.lifecycle.dispose(); }
});


test('a running operation prevents selection until it finishes', async () => {
  let finish: (value: unknown) => void = () => {};
  const pending = new Promise(resolve => { finish = resolve; });
  const { harness, watch } = setup(() => pending);
  try {
    await watch();
    await harness.behavior.callRpc('run', { threadId: 't', root: '/work', request: { kind: 'push' }, origin: 'user' });
    await assert.rejects(harness.behavior.callRpc('select', { threadId: 't', path: 'app' }), /running Git operation/);
    assert.equal(rpcContract.watch.output.parse(await watch()).root, '/work');
    finish({ ok: true, summary: 'Done' });
    await new Promise(resolve => setImmediate(resolve));
    await harness.behavior.callRpc('select', { threadId: 't', path: 'app' });
    assert.equal(rpcContract.watch.output.parse(await watch()).root, '/work/app');
  } finally { finish({ ok: true, summary: 'Done' }); await harness.lifecycle.dispose(); }
});
