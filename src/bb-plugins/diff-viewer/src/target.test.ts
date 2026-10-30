import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

test('explicit checkout routes every read without changing the thread environment', async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: 'env' }) },
      environments: { get: async () => ({ id: 'env', hostId: 'host_test', path: '/parent' }) },
    },
    experimental_callHostRpc: async ({ method }) => method === 'load' ? { kind: 'none' }
      : method === 'file' ? { kind: 'empty' } : 'fingerprint',
  });
  plugin(bb);
  try {
    const target = { hostId: 'host_test', path: '/review' };
    await harness.behavior.callRpc('load', { threadId: 't', target, scope: { kind: 'uncommitted' } });
    await harness.behavior.callRpc('fingerprint', { threadId: 't', target });
    await harness.behavior.callRpc('file', { threadId: 't', target, spec: { from: 'a'.repeat(40), to: null, untracked: true }, path: 'a', oldPath: null, untracked: false });
    assert.deepEqual(harness.experimental_hostRpcCalls.map(call => [call.hostId, (call.input as { root: string; exact: boolean }).root, (call.input as { exact: boolean }).exact]),
      Array.from({ length: 3 }, () => ['host_test', '/review', true]));
    await harness.behavior.callRpc('load', { threadId: 't', scope: { kind: 'uncommitted' } });
    const lastCall = harness.experimental_hostRpcCalls.at(-1);
    assert.ok(lastCall);
    assert.equal((lastCall.input as { root: string }).root, '/parent');
    await assert.rejects(harness.behavior.callRpc('load', { threadId: 't', target: { ...target, hostId: 'host_other' }, scope: { kind: 'uncommitted' } }), /host/i);
    assert.equal(harness.inspection.sdk.callsTo('threads.update').length, 0);
  } finally { await harness.lifecycle.dispose(); }
});
