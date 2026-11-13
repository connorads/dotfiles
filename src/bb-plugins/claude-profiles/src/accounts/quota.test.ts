import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from './quota.ts';
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
  for (const input of [{ rate_limits_available: true, rate_limits: {} }, { rate_limits_available: false }]) {
    assert.partialDeepStrictEqual(parseUsage(input), { status: 'ok', windows: [], message: 'No limits reported' });
  }
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
  } }).windows.length, 0);
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
test('reads model-scoped weekly limits that Claude reports only in its limits list', () => {
  const result = parseUsage({ rate_limits_available: true, rate_limits: {
    seven_day: { utilization: 8, resets_at: '2026-11-14T04:00:00Z' },
    seven_day_opus: { utilization: 3, resets_at: null },
    model_scoped: [{ display_name: 'Fable', utilization: 9, resets_at: '2026-11-14T04:00:00Z' }],
    limits: [
      { kind: 'weekly_all', percent: 8, resets_at: '2026-11-14T04:00:00Z', scope: null },
      { kind: 'weekly_scoped', percent: 9, resets_at: '2026-11-14T04:00:00Z', scope: { model: { id: null, display_name: 'Fable' } } },
      { kind: 'weekly_scoped', percent: 3, resets_at: null, scope: { model: { id: null, display_name: 'Opus' } } },
      { kind: 'weekly_scoped', percent: null, scope: { model: { display_name: 'Sonnet' } } },
    ],
  } });
  assert.deepEqual(result.windows.map(w => [w.id, w.label, w.usedPercent]),
    [['seven_day', 'Seven days', 8], ['seven_day_opus', 'seven day opus', 3], ['seven_day_fable', 'Fable', 9]]);
});
