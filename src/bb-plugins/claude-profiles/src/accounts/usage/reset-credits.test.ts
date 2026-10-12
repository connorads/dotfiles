import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResetCredits } from './reset-credits.ts';

const counts = { available_count: 3, applicable_available_count: 0 };
// Partial matching treats an expected [] as a subset of any array, so expiries are compared whole.
const summary = (value: ReturnType<typeof parseResetCredits>) => value.status === 'ok'
  ? { held: value.held, usable: value.usable, expiries: value.expiries, unknownExpiryCount: value.unknownExpiryCount } : value;

test('keeps held and usable counts distinct, groups expiries and excludes redeemed credits', () => {
  assert.deepEqual(parseResetCredits({ email: 'cli@example.com', rate_limit_reset_credits: counts,
    _reset_credit_details: { credits: [
      { status: 'available', expires_at: '2026-10-29T18:53:05Z' },
      { status: 'redeemed', expires_at: '2026-10-20T18:53:05Z' },
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
    ] } }, 123), { status: 'ok', accountLabel: 'cli@example.com', observedAt: 123,
    held: 3, usable: 0, expiries: [
      { count: 2, expiresAt: '2026-10-22T20:34:57.000Z' }, { count: 1, expiresAt: '2026-10-29T18:53:05.000Z' },
    ], unknownExpiryCount: 0 });
});

test('missing or malformed expiry details do not invent a deadline or lose counts', () => {
  for (const details of [undefined, { credits: [] }, { credits: [{ status: 'available', expires_at: 'bad' }] }]) {
    assert.deepEqual(summary(parseResetCredits({ rate_limit_reset_credits: counts, _reset_credit_details: details }, 123)),
      { held: 3, usable: 0, expiries: [], unknownExpiryCount: 3 });
  }
});

test('missing and invalid counts report unavailable instead of zero', () => {
  for (const value of [{}, { rate_limit_reset_credits: { available_count: -1, applicable_available_count: 0 } },
    { rate_limit_reset_credits: { available_count: 1, applicable_available_count: 2 } }]) {
    assert.equal(parseResetCredits(value, 123).status, 'unavailable');
  }
});

test('zero credits is a known zero; extra grant records cannot exceed the held count', () => {
  assert.deepEqual(summary(parseResetCredits({ rate_limit_reset_credits: { available_count: 0, applicable_available_count: 0 } }, 123)),
    { held: 0, usable: 0, expiries: [], unknownExpiryCount: 0 });
  assert.deepEqual(summary(parseResetCredits({ rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
    _reset_credit_details: { credits: [
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
      { status: 'available', expires_at: '2026-10-29T18:53:05Z' },
    ] } }, 123)), { held: 1, usable: 0, expiries: [], unknownExpiryCount: 1 });
});
