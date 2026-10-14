import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBroker } from './broker.ts';

test('only one focused window can claim a command and complete it', async () => {
  let requestId = '';
  const broker = makeBroker(request => { requestId = request.requestId; });
  const reply = broker.dispatch({ action: 'help' });
  assert.equal(broker.claim(requestId), true);
  assert.equal(broker.claim(requestId), false);
  assert.equal(broker.complete(requestId, { ok: true, message: 'Voice help' }), true);
  assert.deepEqual(await reply, { ok: true, message: 'Voice help', requestId });
  assert.equal(broker.complete(requestId, { ok: true, message: 'Duplicate' }), false);
  broker.dispose();
});

test('unclaimed commands expire without a later window executing them', async () => {
  let requestId = '';
  const broker = makeBroker(request => { requestId = request.requestId; }, 5);
  const reply = await broker.dispatch({ action: 'new' });
  assert.equal(reply.ok, false);
  assert.match(reply.message, /focused BB window/);
  assert.equal(broker.claim(requestId), false);
  broker.dispose();
});

test('an unclaimed command fails at the claim deadline rather than the completion timeout', async () => {
  const broker = makeBroker(() => {}, 1000, 5);
  const started = Date.now();
  const reply = await broker.dispatch({ action: 'help' });
  assert.equal(reply.ok, false);
  assert.match(reply.message, /No focused BB window/);
  assert.ok(Date.now() - started < 500);
  broker.dispose();
});

test('a claimed command outlives the claim deadline', async () => {
  let requestId = '';
  const broker = makeBroker(request => { requestId = request.requestId; }, 1000, 5);
  const reply = broker.dispatch({ action: 'help' });
  assert.equal(broker.claim(requestId), true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(broker.complete(requestId, { ok: true, message: 'Voice help' }), true);
  assert.equal((await reply).ok, true);
  broker.dispose();
});

test('reload releases pending requests and rejects new work', async () => {
  const broker = makeBroker(() => {});
  const reply = broker.dispatch({ action: 'help' });
  broker.dispose();
  assert.equal((await reply).ok, false);
  assert.equal((await broker.dispatch({ action: 'help' })).ok, false);
});
