import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_MS, initial, LEASE_MS, step, type Machine } from './agents.ts';
import type { LibStatus } from './domain.ts';

const now = 1_000_000;
const owned = (deadline = now + LEASE_MS): LibStatus => ({ kind: 'on', lid: false, pid: 7, deadline, startedAt: now, owner: 'bb-agents' });
const holding = (busy: number, lease = now + LEASE_MS): Machine => ({ agents: { phase: 'holding', busy }, lease });
const grace = (until: number, lease = now + LEASE_MS): Machine => ({ agents: { phase: 'grace', until }, lease });
const kinds = (effects: { kind: string }[]) => effects.map(effect => effect.kind);

test('arm starts an owned lease, then grace starts at once and the count decides', () => {
  assert.deepEqual(step(initial, { kind: 'arm' }, now), { machine: initial, effects: [{ kind: 'startOwned' }] });
  const started = step(initial, { kind: 'started', ok: true }, now);
  assert.deepEqual(started.machine, grace(now + GRACE_MS));
  assert.deepEqual(started.effects, [{ kind: 'scheduleTick', at: now + GRACE_MS }, { kind: 'queryBusy' }]);
  assert.deepEqual(step(started.machine, { kind: 'busy', n: 2 }, now).machine, holding(2));
});

test('a failed start leaves agents mode off', () => {
  assert.deepEqual(step(initial, { kind: 'started', ok: false }, now), { machine: initial, effects: [] });
});

test('arming twice does nothing', () => {
  assert.deepEqual(step(holding(1), { kind: 'arm' }, now).effects, []);
});

test('the last thread going idle starts grace', () => {
  const next = step(holding(1), { kind: 'busy', n: 0 }, now);
  assert.deepEqual(next.machine, grace(now + GRACE_MS));
  assert.deepEqual(next.effects, [{ kind: 'scheduleTick', at: now + GRACE_MS }]);
});

test('a thread starting during grace cancels it', () => {
  const next = step(grace(now + 60_000), { kind: 'busy', n: 1 }, now);
  assert.deepEqual(next.machine, holding(1));
  assert.deepEqual(kinds(next.effects), ['cancelTick']);
});

test('the grace tick counts once more before it stops', () => {
  const until = now + GRACE_MS;
  assert.deepEqual(kinds(step(grace(until), { kind: 'tick' }, until).effects), ['queryBusy']);
  assert.deepEqual(kinds(step(grace(until), { kind: 'busy', n: 0 }, until).effects), ['stopOwned']);
  // A thread that started at the edge keeps it.
  assert.deepEqual(step(grace(until), { kind: 'busy', n: 1 }, until).machine.agents, { phase: 'holding', busy: 1 });
  // An idle count before the deadline changes nothing.
  assert.deepEqual(step(grace(until), { kind: 'busy', n: 0 }, now).effects, []);
  assert.deepEqual(step(grace(until), { kind: 'stopped' }, until).machine, initial);
});

test('renews only while holding and under 30 minutes left', () => {
  const lease = now + 29 * 60_000;
  assert.deepEqual(kinds(step(holding(1, lease), { kind: 'busy', n: 1 }, now).effects), ['cancelTick', 'renewOwned']);
  assert.deepEqual(kinds(step(holding(1, lease), { kind: 'tick' }, now).effects), ['renewOwned', 'queryBusy']);
  assert.deepEqual(kinds(step(holding(1, now + 31 * 60_000), { kind: 'tick' }, now).effects), ['queryBusy']);
  // In grace the lease outlasts the 5 minutes, so there is nothing to renew.
  assert.deepEqual(kinds(step(grace(now + GRACE_MS, lease), { kind: 'tick' }, now).effects), ['queryBusy']);
  assert.deepEqual(step(holding(1, lease), { kind: 'renewed', result: 'renewed' }, now).machine.lease, now + LEASE_MS);
});

test('a foreign owner or OFF relinquishes without touching the lib', () => {
  const manual: LibStatus = { kind: 'on', lid: false, pid: 8, deadline: null, startedAt: now, owner: null };
  for (const lib of [manual, { kind: 'off' } as LibStatus, { ...manual, lid: true, deadline: now + 1 } as LibStatus]) {
    const next = step(holding(2), { kind: 'observe', lib }, now);
    assert.deepEqual(next.machine, initial);
    assert.deepEqual(kinds(next.effects), ['cancelTick']);
  }
});

test('an owned session seen while idle is adopted with a fresh grace', () => {
  const next = step(initial, { kind: 'observe', lib: owned(now + 40 * 60_000) }, now);
  assert.deepEqual(next.machine, grace(now + GRACE_MS, now + 40 * 60_000));
  assert.deepEqual(kinds(next.effects), ['scheduleTick', 'queryBusy']);
});

test('an owned session seen while armed only refreshes the lease', () => {
  assert.deepEqual(step(holding(1), { kind: 'observe', lib: owned(now + 5) }, now), { machine: holding(1, now + 5), effects: [] });
});

test('not-owned answers end agents mode', () => {
  assert.deepEqual(step(holding(1), { kind: 'renewed', result: 'not-owned' }, now).machine, initial);
});

test('user off stops the owned session; idle ignores it', () => {
  assert.deepEqual(kinds(step(holding(1), { kind: 'userOff' }, now).effects), ['stopOwned']);
  assert.deepEqual(step(initial, { kind: 'userOff' }, now).effects, []);
});

test('inputs while idle do nothing', () => {
  for (const input of [{ kind: 'busy', n: 3 }, { kind: 'tick' }] as const) assert.deepEqual(step(initial, input, now), { machine: initial, effects: [] });
});
