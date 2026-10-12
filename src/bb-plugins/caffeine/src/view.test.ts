import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from './view.ts';
import type { LibStatus } from './domain.ts';

const idle = { phase: 'idle' } as const;
const on = (patch: Partial<Extract<LibStatus, { kind: 'on' }>> = {}): LibStatus =>
  ({ kind: 'on', lid: false, pid: 42, deadline: 2_000, startedAt: 1_000, owner: null, ...patch });

test('unsupported and off pass through', () => {
  assert.deepEqual(compose({ kind: 'unsupported', reason: 'no-caffeinate' }, idle), { kind: 'unsupported', reason: 'no-caffeinate' });
  assert.deepEqual(compose({ kind: 'off' }, { phase: 'grace', until: 9 }), { kind: 'off' });
});

test('a manual session is on, timed or indefinite', () => {
  assert.deepEqual(compose(on(), idle), { kind: 'on', deadline: 2_000, startedAt: 1_000 });
  assert.deepEqual(compose(on({ deadline: null }), idle), { kind: 'on', deadline: null, startedAt: 1_000 });
});

test('a lid session is lid', () => {
  assert.deepEqual(compose(on({ lid: true }), idle), { kind: 'lid', deadline: 2_000, startedAt: 1_000 });
});

test('an owned session is agents mode, with the controller detail', () => {
  const owned = on({ owner: 'bb-agents' });
  assert.deepEqual(compose(owned, { phase: 'holding', busy: 2 }), { kind: 'agents', busy: 2, graceUntil: null, leaseDeadline: 2_000 });
  assert.deepEqual(compose(owned, { phase: 'grace', until: 1_500 }), { kind: 'agents', busy: null, graceUntil: 1_500, leaseDeadline: 2_000 });
  // Before a restarted server adopts it: still agents mode, never a plain timed session.
  assert.deepEqual(compose(owned, idle), { kind: 'agents', busy: null, graceUntil: null, leaseDeadline: 2_000 });
});

test('another owner reads as a manual session', () => {
  assert.equal(compose(on({ owner: 'someone-else' }), idle).kind, 'on');
});
