import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pace, periodStart, tone } from './pace.ts';

const HOUR = 3_600_000;
const reset = new Date('2026-10-12T17:00:00Z');
const at = (hoursBeforeReset: number) => new Date(reset.getTime() - hoursBeforeReset * HOUR);
const fiveHour = (usedPercent: number) => ({ usedPercent, resetsAt: reset.toISOString(), period: 'five-hour' as const });

test('a window whose reset has passed is obsolete, not a live reading', () => {
  assert.deepEqual(pace(fiveHour(78), new Date(reset.getTime() + 1)), { kind: 'elapsed' });
});

test('a full window reports when it comes back', () => {
  assert.deepEqual(pace(fiveHour(100), at(2)), { kind: 'limited', resetsAt: reset });
});

test('windows without a known length or reset have no pace', () => {
  assert.deepEqual(pace({ usedPercent: 3, resetsAt: reset.toISOString(), period: null }, at(1)), { kind: 'untimed' });
  assert.deepEqual(pace({ usedPercent: 0, resetsAt: null, period: 'five-hour' }, at(1)), { kind: 'untimed' });
});

test('projection waits until enough of the window has elapsed', () => {
  assert.deepEqual(pace(fiveHour(20), at(4.9)), { kind: 'early', expectedPercent: 2 });
});

test('usage within five points of even spending is on pace', () => {
  assert.partialDeepStrictEqual(pace(fiveHour(42), at(3)), { kind: 'paced', status: 'on', expectedPercent: 40, runsOutAt: null });
});

test('usage well below even spending is under pace', () => {
  assert.partialDeepStrictEqual(pace(fiveHour(10), at(3)), { kind: 'paced', status: 'under' });
});

test('slightly fast usage is ahead but not yet projected to run out', () => {
  assert.partialDeepStrictEqual(pace(fiveHour(46), at(3)), { kind: 'paced', status: 'ahead', runsOutAt: null });
});

test('fast usage projects the run-out time at the current rate', () => {
  // 2h elapsed, 60% used: 30%/h, so the remaining 40% lasts 80 minutes.
  const result = pace(fiveHour(60), at(3));
  assert.partialDeepStrictEqual(result, { kind: 'paced', status: 'over', expectedPercent: 40 });
  assert.equal(result.kind === 'paced' && result.runsOutAt?.toISOString(), new Date(at(3).getTime() + 80 * 60_000).toISOString());
});

test('monthly windows start one calendar month before the reset', () => {
  assert.equal(periodStart('month', new Date('2026-03-31T08:00:00Z')).toISOString(), '2026-02-28T08:00:00.000Z');
  assert.equal(periodStart('month', new Date('2026-10-27T08:49:50Z')).toISOString(), '2026-09-27T08:49:50.000Z');
  assert.equal(periodStart('week', new Date('2026-10-19T00:00:00Z')).toISOString(), '2026-10-12T00:00:00.000Z');
});

test('tone escalates on pace and on absolute use', () => {
  assert.equal(tone(42, pace(fiveHour(42), at(3))), 'normal');
  assert.equal(tone(60, pace(fiveHour(60), at(3))), 'critical');
  assert.equal(tone(55, pace(fiveHour(55), at(2.75))), 'warning');
  assert.equal(tone(72, { kind: 'untimed' }), 'warning');
  assert.equal(tone(91, { kind: 'untimed' }), 'critical');
  assert.equal(tone(100, pace(fiveHour(100), at(1))), 'critical');
  assert.equal(tone(95, { kind: 'elapsed' }), 'normal');
});
