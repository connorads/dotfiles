import { expect, test } from 'vitest';
import { readingState, viewWindow } from './format.ts';
import type { UsageWindow } from './contracts.ts';

const now = new Date('2026-10-12T12:00:00Z');
const window: UsageWindow = { label: '5-hour', period: 'five-hour', usedPercent: 90,
  resetsAt: '2026-10-12T14:00:00Z', cost: null };

test('reading age follows the shortest allowance and never invents a measurement time', () => {
  expect(readingState(null, [window], now)).toBe('unknown');
  expect(readingState(now.getTime() - 14 * 60_000, [window], now)).toBe('fresh');
  expect(readingState(now.getTime() - 15 * 60_000, [window], now)).toBe('stale');
  expect(readingState(now.getTime() - 3_600_000, [{ ...window, period: 'week' }], now)).toBe('fresh');
});

test('stale and unknown ages suppress pace estimates, but retain reported use and reset dates', () => {
  expect(viewWindow(window, now).status).toContain('At this pace, out');
  expect(viewWindow(window, now, 'stale')).toMatchObject({ pace: { kind: 'untimed' }, status: 'Cached reading',
    reset: expect.stringMatching(/^Resets /) });
  expect(viewWindow(window, now, 'unknown').status).toBe('Reading age unknown');
});

test('expired credit allowances request a refresh instead of suggesting an active balance', () => {
  expect(viewWindow({ ...window, period: null, resetsAt: '2026-10-11T12:00:00Z',
    cost: { usedUsdCents: 10, limitUsdCents: 100 } }, now)).toMatchObject({ status: 'Expired · refresh needed' });
});
