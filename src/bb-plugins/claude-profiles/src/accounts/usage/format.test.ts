import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingState, viewWindow } from './format.ts';
import type { UsageWindow } from './contract.ts';

const now = new Date('2026-10-12T12:00:00Z');
const window: UsageWindow = { label: '5-hour', period: 'five-hour', usedPercent: 90,
  resetsAt: '2026-10-12T14:00:00Z', cost: null };

test('reading age follows the shortest allowance and never invents a measurement time', () => {
  assert.equal(readingState(null, [window], now), 'unknown');
  assert.equal(readingState(now.getTime() - 14 * 60_000, [window], now), 'fresh');
  assert.equal(readingState(now.getTime() - 15 * 60_000, [window], now), 'stale');
  assert.equal(readingState(now.getTime() - 3_600_000, [{ ...window, period: 'week' }], now), 'fresh');
});

test('stale and unknown ages suppress pace estimates, but retain reported use and reset dates', () => {
  assert.match(viewWindow(window, now).status, /At this pace, out/);
  const stale = viewWindow(window, now, 'stale');
  assert.deepEqual(stale.pace, { kind: 'untimed' });
  assert.equal(stale.status, 'Cached reading');
  assert.match(stale.reset ?? '', /^Resets /);
  assert.equal(viewWindow(window, now, 'unknown').status, 'Reading age unknown');
});

test('expired credit allowances request a refresh instead of suggesting an active balance', () => {
  assert.equal(viewWindow({ ...window, period: null, resetsAt: '2026-10-11T12:00:00Z',
    cost: { usedUsdCents: 10, limitUsdCents: 100 } }, now).status, 'Expired · refresh needed');
});

test('the detail phrase gives the run-out, the time to reset or the credit balance', () => {
  assert.match(viewWindow(window, now).detail ?? '', /^Out \S/);
  assert.equal(viewWindow({ ...window, usedPercent: 10 }, now).detail, 'Resets in 2h 0m');
  assert.equal(viewWindow({ ...window, period: null, resetsAt: '2026-11-04T12:00:00Z', cost: { usedUsdCents: 6, limitUsdCents: 25000 } }, now).detail,
    '$0.06 of $250');
  assert.equal(viewWindow({ ...window, period: null, resetsAt: '2026-10-11T12:00:00Z',
    cost: { usedUsdCents: 10, limitUsdCents: 100 } }, now).detail, 'Expired · refresh needed');
});
