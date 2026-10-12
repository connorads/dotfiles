import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from './usage.ts';
test('preserves quota windows including model-specific limits', () => {
  const result = parseUsage({ rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 12, resets_at: '2026-10-11T01:00:00Z' },
    seven_day_sonnet: { utilization: 21, resets_at: null },
    future_window: { utilization: 4, resets_at: null },
  } });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows.map(w => w.usedPercent), [12, 21, 4]);
});
test('does not invent zero usage when Claude returns no recognised limits', () => {
  assert.equal(parseUsage({ rate_limits_available: true, rate_limits: {} }).status, 'unavailable');
  assert.equal(parseUsage({ rate_limits_available: false }).status, 'unavailable');
});
test('rejects invalid percentages without breaking other windows', () => {
  const result = parseUsage({ rate_limits_available: true, rate_limits: {
    bad: { utilization: -1 }, five_hour: { utilization: 5 },
  } });
  assert.equal(result.windows.length, 1);
});
test('does not present paid extra usage as a subscription quota window', () => {
  assert.equal(parseUsage({ rate_limits_available: true, rate_limits: {
    extra_usage: { utilization: 100, is_enabled: false },
  } }).status, 'unavailable');
});
test('presents a dollar allowance as credits, not a codename rate limit', () => {
  const result = parseUsage({ rate_limits_available: true, rate_limits: {
    iguana_necktie: { utilization: 0.0253, resets_at: '2026-11-05T07:59:00Z', limit_dollars: 250, used_dollars: 0.063206 },
  } });
  assert.deepEqual(result.windows, [{ id: 'iguana_necktie', label: 'Credits', usedPercent: 0.0253,
    resetsAt: '2026-11-05T07:59:00Z', cost: { usedUsdCents: 6.3206, limitUsdCents: 25000 } }]);
});
test('labels unrecognised limits generically instead of exposing internal names', () => {
  const result = parseUsage({ rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 5 }, tangelo: { utilization: 3 },
  } });
  assert.deepEqual(result.windows.map(w => [w.label, w.cost]), [['Five hours', null], ['Other limit', null]]);
});
