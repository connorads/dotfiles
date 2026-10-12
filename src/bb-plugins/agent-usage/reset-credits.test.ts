import { expect, test } from 'vitest';
import { parseResetCredits } from './reset-credits.ts';

const counts = { available_count: 3, applicable_available_count: 0 };

test('keeps held and usable counts distinct, groups expiries and excludes redeemed credits', () => {
  expect(parseResetCredits({ email: 'cli@example.com', rate_limit_reset_credits: counts,
    _reset_credit_details: { credits: [
      { status: 'available', expires_at: '2026-10-29T18:53:05Z' },
      { status: 'redeemed', expires_at: '2026-10-20T18:53:05Z' },
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
    ] } }, 123)).toEqual({ status: 'ok', accountLabel: 'cli@example.com', observedAt: 123,
    held: 3, usable: 0, expiries: [
      { count: 2, expiresAt: '2026-10-22T20:34:57.000Z' }, { count: 1, expiresAt: '2026-10-29T18:53:05.000Z' },
    ], unknownExpiryCount: 0 });
});

test('missing or malformed expiry details do not invent a deadline or lose counts', () => {
  for (const details of [undefined, { credits: [] }, { credits: [{ status: 'available', expires_at: 'bad' }] }]) {
    expect(parseResetCredits({ rate_limit_reset_credits: counts, _reset_credit_details: details }, 123))
      .toMatchObject({ status: 'ok', held: 3, usable: 0, expiries: [], unknownExpiryCount: 3 });
  }
});

test('missing and invalid counts report unavailable instead of zero', () => {
  for (const value of [{}, { rate_limit_reset_credits: { available_count: -1, applicable_available_count: 0 } },
    { rate_limit_reset_credits: { available_count: 1, applicable_available_count: 2 } }]) {
    expect(parseResetCredits(value, 123)).toMatchObject({ status: 'unavailable' });
  }
});

test('zero credits is a known zero; extra grant records cannot exceed the held count', () => {
  expect(parseResetCredits({ rate_limit_reset_credits: { available_count: 0, applicable_available_count: 0 } }, 123))
    .toMatchObject({ status: 'ok', held: 0, expiries: [], unknownExpiryCount: 0 });
  expect(parseResetCredits({ rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
    _reset_credit_details: { credits: [
      { status: 'available', expires_at: '2026-10-22T20:34:57Z' },
      { status: 'available', expires_at: '2026-10-29T18:53:05Z' },
    ] } }, 123)).toMatchObject({ status: 'ok', held: 1, expiries: [], unknownExpiryCount: 1 });
});
