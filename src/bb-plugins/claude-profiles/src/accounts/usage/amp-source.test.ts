import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAmpSource } from './amp-source.ts';

const hosts = async () => [{ id: 'mac', name: 'Mac', status: 'connected' as const }];
test('Amp readings cache native text and forced refresh preserves prior text on failure', async () => {
  let calls = 0;
  const source = createAmpSource(hosts, async () => ++calls === 1
    ? { status: 'ok', text: 'Credits: $12.50', observedAt: 1000 }
    : { status: 'unavailable', message: 'Cannot collect usage' }, () => 1001);
  assert.equal((await source.read(false)).machines[0]?.reading.status, 'ok');
  await source.read(false);
  assert.equal(calls, 1);
  const failed = (await source.read(true)).machines[0];
  assert.partialDeepStrictEqual(failed, { reading: { status: 'ok', text: 'Credits: $12.50', observedAt: 1000 }, message: 'Cannot collect usage' });
});
test('Amp collection failures are isolated and disconnected hosts are not contacted', async () => {
  const source = createAmpSource(async () => [...await hosts(), { id: 'offline', name: 'Remote', status: 'disconnected' as const }],
    async id => { assert.equal(id, 'mac'); throw new Error('Network failed'); });
  const result = await source.read(true);
  assert.equal(result.machines.length, 2);
  assert.partialDeepStrictEqual(result.machines[0], { reading: { status: 'unavailable' } });
  assert.partialDeepStrictEqual(result.machines[1], { reading: { status: 'unavailable', message: 'Machine is offline.' } });
});
test('Amp overlapping refreshes collect once per host', async () => {
  let calls = 0;
  const source = createAmpSource(hosts, async () => { calls++; return { status: 'ok', text: 'Credits: $1', observedAt: 1000 }; });
  await Promise.all([source.read(true), source.read(true)]);
  assert.equal(calls, 1);
});
