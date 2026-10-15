import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import { rpcContract } from '../contracts.ts';

for (const transportFails of [false, true]) for (const origin of ['auto', 'user'] as const) test(`${origin} ${transportFails ? 'request' : 'authentication'} failure survives a local action and clears only after successful fetch`, async () => {
  let succeeds = false;
  const { bb, harness } = createFakePluginHost({
    sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: 'env' }) },
      environments: { get: async () => ({ id: 'env', hostId: 'mac', path: '/work' }) },
    },
    experimental_callHostRpc: async ({ method, input }) => {
      if (method === 'watch') return { kind: 'none' };
      const { request } = input as { request: { kind: string } };
      if (request.kind === 'fetch' && !succeeds && transportFails) throw new Error('Host request failed');
      if (request.kind === 'fetch' && !succeeds) return { ok: false, failure: { reason: 'auth', message: 'Permission denied (publickey).' } };
      return { ok: true, summary: 'Done' };
    },
  });
  plugin(bb);
  const watch = async () => rpcContract.watch.output.parse(await harness.behavior.callRpc('watch', { threadId: 't', clientId: 'a' }));
  const run = async (kind: 'fetch' | 'switch', automatic = false) => {
    await harness.behavior.callRpc('run', { threadId: 't', root: '/work',
      request: kind === 'switch' ? { kind, branch: 'other', track: false } : { kind }, origin: automatic ? 'auto' : 'user' });
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    assert.deepEqual((await watch()).fetch, { lastSucceededAt: null, failure: null });
    await run('fetch', origin === 'auto');
    const failed = (await watch()).fetch;
    assert.equal(failed.failure?.reason, transportFails ? 'unknown' : 'auth');
    assert.equal(failed.lastSucceededAt, null);
    await run('switch');
    assert.deepEqual((await watch()).fetch, failed);
    succeeds = true;
    await run('fetch');
    const recovered = (await watch()).fetch;
    assert.equal(recovered.failure, null);
    assert.equal(typeof recovered.lastSucceededAt, 'number');
    succeeds = false;
    await run('fetch');
    assert.equal((await watch()).fetch.lastSucceededAt, recovered.lastSucceededAt);
    assert.ok((await watch()).fetch.failure);
  } finally { await harness.lifecycle.dispose(); }
});
