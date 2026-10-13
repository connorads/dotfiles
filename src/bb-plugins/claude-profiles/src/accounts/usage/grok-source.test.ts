import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrokSource } from './grok-source.ts';
import type { Measurement } from '../usage-source.ts';

const reading: Measurement = { accountKey: null, observedAt: 1000, usage: {
  status: 'ok', plan: null, accountEmail: null, planLabel: 'Premium+', windows: [
    { id: 'weekly', label: 'Weekly', kind: 'weekly', usedPercent: 3, resetsAt: '2026-10-18T01:19:06Z', model: null, cost: null },
  ],
} };
test('Grok inventory does not collect quota and preserves the host in its resource', async () => {
  const source = createGrokSource(async () => { throw new Error('Inventory must not collect'); });
  assert.deepEqual(source.resources([{ id: 'mac', name: 'Mac' }]), [{
    id: JSON.stringify(['grok', 'mac']), accountKey: null, providerId: 'acp-grok', label: 'Grok Build',
    scope: { kind: 'host', hostId: 'mac', hostName: 'Mac' },
  }]);
});
test('cached reads share a successful observation and force refresh collects only the requested host', async () => {
  const hosts: string[] = [];
  const source = createGrokSource(async hostId => { hosts.push(hostId); return reading; }, () => 1001);
  const id = JSON.stringify(['grok', 'mac']);
  assert.deepEqual(await source.read(id, false), reading);
  assert.deepEqual(await source.read(id, false), reading);
  assert.deepEqual(await source.read(id, true), reading);
  assert.deepEqual(hosts, ['mac', 'mac']);
});
test('concurrent requests share one probe and an old reading is refreshed', async () => {
  let calls = 0;
  let now = 1000;
  const source = createGrokSource(async () => { calls++; return reading; }, () => now);
  const id = JSON.stringify(['grok', 'mac']);
  await Promise.all([source.read(id, true), source.read(id, true)]);
  assert.equal(calls, 1);
  now = 61001;
  await source.read(id, false);
  assert.equal(calls, 2);
});
test('failed refresh keeps the last successful observation with an explicit failure message', async () => {
  let fail = false;
  const source = createGrokSource(async () => { if (fail) throw new Error('offline'); return reading; }, () => 1001);
  const id = JSON.stringify(['grok', 'mac']);
  await source.read(id, false);
  fail = true;
  const result = await source.read(id, true);
  assert.equal(result.observedAt, 1000);
  assert.equal(result.usage.status, 'error');
  assert.match(result.usage.status === 'error' ? result.usage.message : '', /refresh/i);
});
test('Grok resource parsing rejects unrelated or invalid resources', async () => {
  const source = createGrokSource(async () => reading);
  assert.equal(source.owns('["grok","mac"]'), true);
  assert.equal(source.owns('["mac","root","default"]'), false);
  await assert.rejects(source.read('["grok",""]', false), /Invalid/);
});
