import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAccount } from './account.ts';

const team = { organizationType: 'claude_team', organizationRateLimitTier: 'default_raven' };
test('labels a standard Team seat', () => {
  assert.deepEqual(parseAccount({ oauthAccount: { ...team, emailAddress: 'a@example.com', seatTier: 'team_standard', userRateLimitTier: 'default_raven' } }),
    { accountEmail: 'a@example.com', planLabel: 'Team Standard' });
});
test('labels a premium Team seat with its multiplier', () => {
  assert.equal(parseAccount({ oauthAccount: { ...team, seatTier: 'team_tier_1', userRateLimitTier: 'default_claude_max_5x' } })?.planLabel,
    'Team Premium (5x)');
});
test('labels the personal top tier as Ultra', () => {
  assert.equal(parseAccount({ oauthAccount: { organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' } })?.planLabel,
    'Ultra');
});
test('returns null without an OAuth account', () => {
  assert.equal(parseAccount({}), null);
  assert.equal(parseAccount('not an object'), null);
});

test('uses current personal plan names and preserves Team and unknown tiers', () => {
  for (const [organizationType, tier, expected] of [
    ['claude_max', 'default_claude_max_5x', 'Max'],
    ['claude_ultra', 'default_claude_max_20x', 'Ultra'],
    ['claude_team', 'default_claude_max_20x', 'Team Premium (20x)'],
    ['claude_max', 'default_claude_max_40x', 'Max (40x)'],
  ]) assert.equal(parseAccount({ oauthAccount: { organizationType, organizationRateLimitTier: tier } })?.planLabel, expected);
});
