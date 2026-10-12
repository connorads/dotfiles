import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache } from './cache.ts';
import { resolveTarget, type TargetPorts } from './target.ts';

const ports = (overrides: Partial<TargetPorts> = {}): TargetPorts => ({
  threadEnvironmentId: async threadId => (threadId === 't-env' ? 'env-1' : null),
  environment: async () => ({ hostId: 'laptop', path: '/repo' }),
  primaryHostId: async () => 'primary',
  ...overrides,
});

test('a thread with a checkout runs skl on that host from that path', async () => {
  assert.deepEqual(await resolveTarget('t-env', ports()), { hostId: 'laptop', cwd: '/repo' });
});

test('no thread, or a thread with no environment, falls back to the primary host without a cwd', async () => {
  assert.deepEqual(await resolveTarget(null, ports()), { hostId: 'primary', cwd: null });
  assert.deepEqual(await resolveTarget('t-bare', ports()), { hostId: 'primary', cwd: null });
});

test('an environment without a path cannot install', async () => {
  const target = await resolveTarget('t-env', ports({ environment: async () => ({ hostId: 'laptop', path: null }) }));
  assert.deepEqual(target, { hostId: 'laptop', cwd: null });
});

test('no primary host is an error', async () => {
  await assert.rejects(resolveTarget(null, ports({ primaryHostId: async () => null })), /no primary host/);
});

test('the cache shares one load per key until the TTL passes', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createCache<number>(1000, () => clock);
  const load = async () => ++loads;
  assert.deepEqual(await Promise.all([cache.get('a', load), cache.get('a', load)]), [1, 1]);
  clock = 999;
  assert.equal(await cache.get('a', load), 1);
  assert.equal(loads, 1);
  assert.equal(await cache.get('b', load), 2);
});

test('an expired entry answers at once and refreshes in the background', async () => {
  let clock = 0;
  let loads = 0;
  let release = () => {};
  const cache = createCache<number>(1000, () => clock);
  const load = () => new Promise<number>(resolve => { const n = ++loads; release = () => resolve(n); });
  const first = cache.get('a', load);
  release();
  assert.equal(await first, 1);
  clock = 1000;
  assert.equal(await cache.get('a', load), 1, 'stale value, no wait for the reload');
  assert.equal(await cache.get('a', load), 1, 'one reload in flight');
  assert.equal(loads, 2);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await cache.get('a', load), 2);
});

test('a failed refresh keeps the stale value', async () => {
  let clock = 0;
  const cache = createCache<number>(1000, () => clock);
  await cache.get('a', async () => 1);
  clock = 1000;
  assert.equal(await cache.get('a', async () => { throw new Error('host down'); }), 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await cache.get('a', async () => 9), 1);
});

test('fresh reloads and replaces the cached value', async () => {
  let loads = 0;
  const cache = createCache<number>(60_000, () => 0);
  const load = async () => ++loads;
  await cache.get('a', load);
  assert.equal(await cache.get('a', load, { fresh: true }), 2);
  assert.equal(await cache.get('a', load), 2);
});

test('a failed load is not cached', async () => {
  const cache = createCache<number>(60_000, () => 0);
  await assert.rejects(cache.get('a', async () => { throw new Error('host down'); }));
  assert.equal(await cache.get('a', async () => 7), 7);
});
