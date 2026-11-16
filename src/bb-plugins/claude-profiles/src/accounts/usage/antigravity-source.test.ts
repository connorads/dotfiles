import assert from 'node:assert/strict';
import test from 'node:test';
import { createAntigravitySource } from './antigravity-source.ts';
import type { Measurement } from '../usage-source.ts';

const reading: Measurement = { accountKey: null, observedAt: 1000,
  usage: { status: 'ok', plan: null, planLabel: null, accountEmail: null, windows: [] } };

test('accounts on the same host have independent caches and quota requests', async () => {
  const calls: string[] = [];
  const source = createAntigravitySource(async (_host, accountId) => {
    calls.push(accountId); return { ...reading, observedAt: accountId === 'default' ? 100 : 200 };
  });
  const resources = source.resources([{ id: 'host-a', name: 'Example', accounts: [
    { id: 'default', label: 'Default' }, { id: 'secondary', label: 'Secondary' },
  ] }]);
  await Promise.all(resources.map(resource => source.read(resource.id, false)));
  assert.deepEqual(calls.sort(), ['default', 'secondary']);
  assert.equal(source.lastReading(resources[0]!.id)?.observedAt, 100);
  assert.equal(source.lastReading(resources[1]!.id)?.observedAt, 200);
  await source.read(resources[1]!.id, true);
  assert.deepEqual(calls, ['default', 'secondary', 'secondary']);
});

test('inventory is host-bound and does not query quota', () => {
  const source = createAntigravitySource(async () => { throw new Error('Must not collect'); });
  assert.deepEqual(source.resources([{ id: 'host-a', name: 'Example machine' }]), [{
    id: '["antigravity","host-a"]', providerId: 'acp-antigravity', label: 'Antigravity', accountKey: null,
    scope: { kind: 'host', hostId: 'host-a', hostName: 'Example machine' },
  }]);
  assert.equal(source.owns('["grok","host-a"]'), false);
});
test('quota is coalesced, cached for two minutes, and forced refresh bypasses cache', async () => {
  let calls = 0;
  let now = 1000;
  const source = createAntigravitySource(async hostId => { assert.equal(hostId, 'host-a'); calls++; return reading; }, () => now);
  const id = '["antigravity","host-a"]';
  await Promise.all([source.read(id, false), source.read(id, true)]);
  assert.equal(calls, 1);
  now = 120999;
  await source.read(id, false);
  assert.equal(calls, 1);
  now = 121000;
  await source.read(id, false);
  await source.read(id, true);
  assert.equal(calls, 3);
});
test('failed refresh is explicit and receives a short cooldown rather than zero quota', async () => {
  let calls = 0;
  let now = 1000;
  const source = createAntigravitySource(async () => { calls++; if (calls > 1) throw new Error('private error'); return reading; }, () => now);
  const id = '["antigravity","host-a"]';
  await source.read(id, false);
  const result = await source.read(id, true);
  assert.equal(result.usage.status, 'error');
  assert.deepEqual(source.lastReading(id), reading);
  assert.equal(JSON.stringify(result).includes('private error'), false);
  await source.read(id, false);
  assert.equal(calls, 2);
  now += 30000;
  await source.read(id, false);
  assert.equal(calls, 3);
});
