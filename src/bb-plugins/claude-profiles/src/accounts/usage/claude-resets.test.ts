import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeResets } from './claude-resets.ts';

const now = Date.parse('2030-01-01T00:00:00Z');
const grant = { id: 'private-redemption-handle', label: 'Provider campaign', resets_left: 1,
  ends_at: '2030-02-01T00:00:00Z', type: 'full', gives_back_weekly: true, paused: false, usable_now: true };

test('groups Fable grants by expiry without exposing redemption handles', () => {
  const reading = parseClaudeResets({ cedar_ember: { eligible: true, grants: [grant, grant,
    { ...grant, type: 'weekly', gives_back_weekly: false, ends_at: '2030-01-10T00:00:00Z' }] } }, now);
  assert.deepEqual(reading, { status: 'ok', observedAt: now, groups: [
    { label: 'Weekly reset', count: 1, usable: 1, expiresAt: '2030-01-10T00:00:00.000Z', paused: false },
    { label: 'Fable reset', count: 2, usable: 2, expiresAt: '2030-02-01T00:00:00.000Z', paused: false },
  ] });
});

test('client refusals and missing reset data remain unknown rather than zero', () => {
  for (const input of [{}, { cedar_ember: null }, { cedar_ember: { eligible: false, ineligible_reason: 'surface' } },
    { cedar_ember: { eligible: true, grants: [{ ...grant, resets_left: 'broken' }] } }]) {
    assert.equal(parseClaudeResets(input, now).status, 'unavailable');
  }
});

test('drops spent and expired grants, preserves held but unusable grants and unknown expiry', () => {
  const reading = parseClaudeResets({ cedar_ember: { eligible: true, grants: [
    { ...grant, resets_left: 0 }, { ...grant, ends_at: '2029-12-31T00:00:00Z' },
    { ...grant, paused: true, usable_now: false }, { ...grant, ends_at: null, usable_now: false },
  ] } }, now);
  assert.partialDeepStrictEqual(reading, { status: 'ok', groups: [
    { count: 1, usable: 0, paused: true }, { count: 1, usable: 0, expiresAt: null },
  ] });
});

test('an explicitly eligible account with no grants has no saved resets', () => {
  assert.deepEqual(parseClaudeResets({ cedar_ember: { eligible: true, grants: [] } }, now),
    { status: 'ok', observedAt: now, groups: [] });
});
