import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaCache, type QuotaConfig } from './quota-cache.ts';
import type { Usage } from './quota.ts';

const config: QuotaConfig = { profileRoot: '/profiles', executable: 'claude' };
const ok = (): Usage => ({ status: 'ok', windows: [], message: null, observedAt: Date.now() });
const failed = (): Usage => ({ status: 'error', windows: [], message: 'Logged out', observedAt: null });

function counted(reading: () => Usage) {
  let reads = 0;
  return { hostUsage: createQuotaCache(async () => { reads += 1; return reading(); }), reads: () => reads };
}

test('serves a successful reading across a two-minute header poll', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const { hostUsage, reads } = counted(ok);
  await hostUsage('host', config, 'work', false);
  t.mock.timers.tick(120_000);
  await hostUsage('host', config, 'work', false);
  assert.equal(reads(), 1);
  t.mock.timers.tick(180_000);
  await hostUsage('host', config, 'work', false);
  assert.equal(reads(), 2);
});

test('serves a failed reading for a minute so focus and polls do not respawn Claude', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const { hostUsage, reads } = counted(failed);
  assert.equal((await hostUsage('host', config, 'work', false)).status, 'error');
  t.mock.timers.tick(30_000);
  await hostUsage('host', config, 'work', false);
  assert.equal(reads(), 1);
  t.mock.timers.tick(30_000);
  await hostUsage('host', config, 'work', false);
  assert.equal(reads(), 2);
});

test('a refresh request bypasses a fresh reading', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const { hostUsage, reads } = counted(ok);
  await hostUsage('host', config, 'work', false);
  await hostUsage('host', config, 'work', true);
  assert.equal(reads(), 2);
});
