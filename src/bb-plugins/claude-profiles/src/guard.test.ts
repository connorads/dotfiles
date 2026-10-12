import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGuard, profileApplied, reviewLaunch } from './guard.ts';

const dir = '/profiles/stretch';

test('a launch counts as applied only when it received this profile directory', () => {
  assert.equal(profileApplied([{ name: 'CLAUDE_CONFIG_DIR', value: dir }], dir), true);
  assert.equal(profileApplied([{ name: 'CLAUDE_CONFIG_DIR', value: { masked: true } }], dir), true);
  assert.equal(profileApplied([{ name: 'CLAUDE_CONFIG_DIR', value: '/profiles/other' }], dir), false);
  assert.equal(profileApplied([{ name: 'HOME', value: '/Users/me' }], dir), false);
});

test('a launch with the profile is recorded and left running', () => {
  const result = reviewLaunch(initialGuard, { seq: 5, applied: true }, 'stretch');
  assert.deepEqual(result, { guard: { checkedSeq: 5, notice: null }, stop: false });
});

test('a launch without the profile is stopped once, with a notice naming the account', () => {
  const first = reviewLaunch(initialGuard, { seq: 5, applied: false }, 'stretch');
  assert.equal(first.stop, true);
  assert.equal(first.guard.checkedSeq, 5);
  assert.match(first.guard.notice ?? '', /without the stretch account/);
  assert.deepEqual(reviewLaunch(first.guard, { seq: 5, applied: false }, 'stretch'), { guard: first.guard, stop: false });
});

test('launches before a switch are never reviewed against the new profile', () => {
  assert.equal(reviewLaunch({ checkedSeq: 9, notice: null }, { seq: 9, applied: false }, 'stretch').stop, false);
});
