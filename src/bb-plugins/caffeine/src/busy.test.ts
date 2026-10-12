import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyCount, type ThreadRow } from './busy.ts';

const mac = 'host-mac';
const row = (id: string, patch: Partial<ThreadRow> = {}): ThreadRow =>
  ({ id, environmentHostId: mac, hasPendingInteraction: false, activity: { activeBackgroundAgentCount: 0 }, ...patch });

test('counts running threads on this Mac only', () => {
  const running = [{ id: 'a', hostId: mac }, { id: 'b', hostId: 'host-dev' }, { id: 'c', hostId: null }];
  assert.equal(busyCount(running, [row('a')], mac), 1);
});

test('a thread waiting on a prompt does not count', () => {
  assert.equal(busyCount([{ id: 'a', hostId: mac }], [row('a', { hasPendingInteraction: true })], mac), 0);
});

test('an idle thread with a background agent counts; background commands alone do not', () => {
  const agent = row('a', { activity: { activeBackgroundAgentCount: 1 } });
  assert.equal(busyCount([], [agent, row('b')], mac), 1);
  const remote = row('c', { environmentHostId: 'host-dev', activity: { activeBackgroundAgentCount: 2 } });
  assert.equal(busyCount([], [remote], mac), 0);
});

test('a thread in both lists counts once', () => {
  assert.equal(busyCount([{ id: 'a', hostId: mac }], [row('a', { activity: { activeBackgroundAgentCount: 1 } })], mac), 1);
});
