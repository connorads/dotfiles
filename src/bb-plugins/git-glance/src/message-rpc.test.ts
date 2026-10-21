import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

function setup() {
  let root = '/work';
  let started!: () => void;
  const generating = new Promise<void>(resolve => { started = resolve; });
  let finish!: (value: { message: string }) => void;
  let hostSignal: AbortSignal | undefined;
  const { bb, harness } = createFakePluginHost({
    settings: { messageModel: 'custom-cheap-model', codexExecutable: '/tools/codex' },
    sdk: {
      threads: { get: async () => makeThreadResponse({ environmentId: 'env' }) },
      environments: { get: async () => ({ id: 'env', hostId: 'remote', path: root }) },
    },
    experimental_callHostRpc: async ({ method, input, signal }) => {
      if (method === 'review') return { head: 'head', index: 'index', count: 1, blocked: null, draftKey: `${root}/.git` };
      if (method !== 'generateMessage') throw new Error(`Unexpected ${method}`);
      assert.deepEqual(input, { root: '/work', head: 'head', index: 'index', draftKey: '/work/.git', model: 'custom-cheap-model', executable: '/tools/codex' });
      hostSignal = signal;
      started();
      return new Promise<{ message: string }>((resolve, reject) => {
        finish = resolve;
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
  });
  plugin(bb);
  const request = { threadId: 't', requestId: 'one', head: 'head', index: 'index', draftKey: JSON.stringify(['remote', '/work/.git']) };
  return { harness, request, generating,
    complete: () => finish({ message: 'Draft subject' }),
    move: () => { root = '/other'; },
    get aborted() { return hostSignal?.aborted; },
  };
}

test('RPC forwards configured model to the repository host and returns only a draft', async () => {
  const h = setup();
  try {
    const pending = h.harness.behavior.callRpc('generateMessage', h.request);
    await h.generating; h.complete();
    assert.deepEqual(await pending, { message: 'Draft subject' });
    assert.equal(h.harness.experimental_hostRpcCalls.some(call => call.method === 'run'), false);
  } finally { await h.harness.lifecycle.dispose(); }
});

test('RPC rejects stale repository reviews before model execution', async () => {
  const h = setup();
  try {
    await assert.rejects(h.harness.behavior.callRpc('generateMessage', { ...h.request, draftKey: 'old repo' }), /Repository changed/);
    assert.equal(h.harness.experimental_hostRpcCalls.some(call => call.method === 'generateMessage'), false);
  } finally { await h.harness.lifecycle.dispose(); }
});

test('RPC refuses duplicate generation and cancels only the matching request', async () => {
  const h = setup();
  try {
    const pending = h.harness.behavior.callRpc('generateMessage', h.request);
    const rejected = assert.rejects(pending, /cancelled/);
    await h.generating;
    await assert.rejects(h.harness.behavior.callRpc('generateMessage', { ...h.request, requestId: 'two' }), /already running/);
    await h.harness.behavior.callRpc('cancelMessage', { threadId: 't', requestId: 'old' });
    assert.equal(h.aborted, false);
    await h.harness.behavior.callRpc('cancelMessage', { threadId: 't', requestId: 'one' });
    await rejected;
    assert.equal(h.aborted, true);
  } finally { await h.harness.lifecycle.dispose(); }
});

test('RPC discards a result after the environment changes', async () => {
  const h = setup();
  try {
    const pending = h.harness.behavior.callRpc('generateMessage', h.request);
    const rejected = assert.rejects(pending, /Repository changed/);
    await h.generating; h.move(); h.complete(); await rejected;
  } finally { await h.harness.lifecycle.dispose(); }
});

test('plugin disposal cancels pending model processes', async () => {
  const h = setup();
  const pending = h.harness.behavior.callRpc('generateMessage', h.request);
  const rejected = assert.rejects(pending, /cancelled/);
  await h.generating;
  await h.harness.lifecycle.dispose();
  await rejected;
  assert.equal(h.aborted, true);
});
