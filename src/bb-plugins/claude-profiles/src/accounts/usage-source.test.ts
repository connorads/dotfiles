import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeResourceId, measurement, measurementSchema } from './usage-source.ts';

test('maps CLI quota into the BB usage contract without inventing account identity', () => {
  const result = measurement({ status: 'ok', observedAt: 123, message: null, windows: [
    { id: 'seven_day_sonnet', label: 'Sonnet', usedPercent: 18, resetsAt: null, cost: null },
  ] });
  assert.equal(measurementSchema.safeParse(result).success, true);
  assert.equal(result.accountKey, null);
  assert.equal(result.usage.status, 'ok');
  if (result.usage.status === 'ok') {
    assert.equal(result.usage.windows[0]?.kind, 'weekly');
    assert.equal(result.usage.windows[0]?.model, 'sonnet');
  }
});
test('failed quota remains an error with the last measurement timestamp', () => {
  const result = measurement({ status: 'error', windows: [], observedAt: 123, message: 'Timed out' });
  assert.equal(result.usage.status, 'error');
  assert.equal(result.observedAt, 123);
});
// BB caches every status but error, so a signed-out profile must not travel as one.
for (const status of ['unauthenticated', 'not_installed'] as const) {
  test(`${status} quota reaches BB as ${status}`, () => {
    const result = measurement({ status, windows: [], observedAt: null, message: 'Sign in' });
    assert.equal(measurementSchema.safeParse(result).success, true);
    assert.equal(result.usage.status, status);
  });
}
test('resource IDs preserve host, profile root and profile names without delimiter ambiguity', () => {
  assert.deepEqual(decodeResourceId(JSON.stringify(['host-1', '/profiles', 'account:two'])), ['host-1', '/profiles', 'account:two']);
  assert.throws(() => decodeResourceId('["host-1"]'), /Invalid/);
  assert.throws(() => decodeResourceId('no JSON'), /Invalid/);
});
test('passes credit cost through to the BB usage contract', () => {
  const cost = { usedUsdCents: 6, limitUsdCents: 25000 };
  const result = measurement({ status: 'ok', observedAt: 1, message: null, windows: [
    { id: 'iguana_necktie', label: 'Credits', usedPercent: 0.02, resetsAt: null, cost },
  ] });
  assert.equal(measurementSchema.safeParse(result).success, true);
  if (result.usage.status === 'ok') assert.deepEqual(result.usage.windows[0]?.cost, cost);
});
test('passes the profile account email and plan label through', () => {
  const result = measurement({ status: 'ok', observedAt: 1, message: null, windows: [],
    account: { accountEmail: 'a@example.com', planLabel: 'Team Standard' } });
  assert.partialDeepStrictEqual(result.usage, { status: 'ok', plan: null, accountEmail: 'a@example.com', planLabel: 'Team Standard' });
});
