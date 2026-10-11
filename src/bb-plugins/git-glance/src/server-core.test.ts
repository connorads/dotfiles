import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeases } from './leases.ts';
import { autoFetchQuietMs, finish, progress, start, type OpState } from './ops.ts';

const home = { hostId: 'h', root: '/r' };

test('the first lease starts a watch and the last one to leave stops it', () => {
  const leases = createLeases(1000);
  assert.equal(leases.touch(home, 'w1:t1', 't1', 0), true);
  assert.equal(leases.touch(home, 'w2:t2', 't2', 0), false);
  assert.deepEqual(leases.threads(home), ['t1', 't2']);
  assert.equal(leases.release(home, 'w1:t1'), null);
  assert.deepEqual(leases.release(home, 'w2:t2'), home);
  assert.equal(leases.touch(home, 'w1:t1', 't1', 0), true);
});

test('unrenewed leases expire; renewed ones survive', () => {
  const leases = createLeases(1000);
  leases.touch(home, 'a', 't1', 0); leases.touch(home, 'b', 't2', 0);
  leases.touch(home, 'b', 't2', 800);
  assert.deepEqual(leases.sweep(1000), []);
  assert.deepEqual(leases.threads(home), ['t2']);
  assert.deepEqual(leases.sweep(1800), [home]);
  assert.deepEqual(leases.checkouts('h'), []);
});

const base = (id: string, at = 0, origin: 'user' | 'auto' = 'user') => ({ id, kind: 'push' as const, origin, startedAt: at });

test('one operation runs at a time, and stale results are ignored', () => {
  const running = start(null, base('a'), null)!;
  assert.equal(running.status, 'running');
  assert.equal(start(running, base('b'), null), null);
  assert.equal(progress(running, 'b', { phase: 'Writing objects', percent: 10 }), null);
  const moved = progress(running, 'a', { phase: 'Writing objects', percent: 10 })!;
  assert.equal(progress(moved, 'a', { phase: 'Writing objects', percent: 10 }), null);
  assert.equal(finish(moved, 'b', { ok: true, summary: 'x' }, 5), null);
  const done = finish(moved, 'a', { ok: true, summary: 'Pushed 1 commit to origin/main' }, 5) as Extract<OpState, { status: 'succeeded' }>;
  assert.deepEqual(done, { id: 'a', kind: 'push', origin: 'user', startedAt: 0, status: 'succeeded', summary: 'Pushed 1 commit to origin/main', finishedAt: 5 });
  assert.equal(start(done, base('c', 6), null)?.status, 'running');
});

test('automatic fetches wait for a quiet period after any fetch or operation', () => {
  assert.equal(start(null, base('a', autoFetchQuietMs - 1, 'auto'), 0), null);
  assert.equal(start(null, base('a', autoFetchQuietMs, 'auto'), 0)?.status, 'running');
  const failed = finish(start(null, base('x', 0), null), 'x', { ok: false, failure: { reason: 'auth', message: 'no' } }, 100);
  assert.equal(start(failed, base('a', 100 + autoFetchQuietMs - 1, 'auto'), null), null);
  assert.equal(start(failed, base('a', 100 + autoFetchQuietMs - 1, 'user'), null)?.status, 'running');
});
