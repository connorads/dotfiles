// The host entry through the SDK's harness, against the real lib and the
// stand-ins in fixture.ts: status signals go out on a change and only then.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import { join } from 'node:path';
import { restore, root, skip } from './fixture.ts';

const { default: entry } = await import('../host.ts');
const harness = experimental_createHostEntryHarness(entry, {
  experimental_paths: { dataDir: join(root, 'data'), tempDir: join(root, 'tmp') },
});
const statuses = () => harness.experimental_getSignals().filter(signal => signal.signal === 'status').map(signal => signal.payload.kind);

after(async () => {
  if (!skip) await harness.experimental_call('stop', {});
  await harness.experimental_dispose();
  await restore();
});

test('a mutation emits at once, and an unchanged state emits nothing', { skip }, async () => {
  assert.deepEqual(await harness.experimental_call('subscribe', {}), { kind: 'off' });
  assert.deepEqual(statuses(), []);

  assert.deepEqual(await harness.experimental_call('start', { secs: 600 }), { ok: true });
  assert.deepEqual(statuses(), ['on']);
  await harness.experimental_call('subscribe', {});
  assert.deepEqual(statuses(), ['on']);

  await harness.experimental_call('stop', {});
  assert.deepEqual(statuses(), ['on', 'off']);
  // A second stop changes nothing, so nothing goes out.
  await harness.experimental_call('stop', {});
  assert.deepEqual(statuses(), ['on', 'off']);
});

test('owned calls report their guard', { skip }, async () => {
  assert.deepEqual(await harness.experimental_call('stopOwned', {}), { result: 'not-owned' });
  assert.deepEqual(await harness.experimental_call('startOwned', { secs: 3600 }), { ok: true });
  assert.deepEqual(await harness.experimental_call('renewOwned', { secs: 3600 }), { result: 'renewed' });
  assert.deepEqual(await harness.experimental_call('stopOwned', {}), { result: 'stopped' });
});
