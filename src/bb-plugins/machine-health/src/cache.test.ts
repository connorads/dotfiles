import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTtlCache } from './cache.ts';

test('callers inside the TTL share one load; after it, a new load runs', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createTtlCache<string, number>(10_000, () => clock);
  const load = async () => ++loads;
  const [a, b] = await Promise.all([cache.get('host', load), cache.get('host', load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  clock = 9_999;
  assert.equal(await cache.get('host', load), 1);
  clock = 10_000;
  assert.equal(await cache.get('host', load), 2);
});

test('machines are cached separately', async () => {
  const cache = createTtlCache<string, string>(10_000, () => 0);
  assert.equal(await cache.get('a', async () => 'A'), 'A');
  assert.equal(await cache.get('b', async () => 'B'), 'B');
});

test('a failed load is not replayed to the next caller', async () => {
  const cache = createTtlCache<string, string>(10_000, () => 0);
  await assert.rejects(cache.get('host', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.get('host', async () => 'back'), 'back');
});

test('a deleted entry loads again inside the TTL', async () => {
  let loads = 0;
  const cache = createTtlCache<string, number>(10_000, () => 0);
  await cache.get('host', async () => ++loads);
  cache.delete('host');
  assert.equal(await cache.get('host', async () => ++loads), 2);
});
