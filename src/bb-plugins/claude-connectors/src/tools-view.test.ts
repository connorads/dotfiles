import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolRow } from '../contracts.ts';
import { filterTools, isCustomOverride, pickDefaultProfile, summarizeTools } from './tools-view.ts';

const sample: ToolRow[] = [
  { name: 'slack_read_channel', description: 'Reads recent messages from a channel.', readOnly: true, access: 'allow' },
  { name: 'slack_search_users', description: 'Searches workspace users by name.', readOnly: true, access: 'off' },
  { name: 'slack_send_message', description: 'Sends a message immediately.', readOnly: false, access: 'off' },
  { name: 'slack_send_message_draft', description: 'Creates a draft saved to Drafts & Sent.', readOnly: false, access: 'allow' },
];

test('isCustomOverride flags allowed write tools and disabled read-only tools', () => {
  assert.equal(isCustomOverride(sample[0]!), false);
  assert.equal(isCustomOverride(sample[1]!), true);
  assert.equal(isCustomOverride(sample[2]!), false);
  assert.equal(isCustomOverride(sample[3]!), true);
});

test('filterTools matches both name and description and applies mode filters', () => {
  assert.equal(filterTools(sample, '', 'all').length, 4);
  assert.deepEqual(filterTools(sample, '', 'writes').map(t => t.name), ['slack_send_message', 'slack_send_message_draft']);
  assert.deepEqual(filterTools(sample, '', 'allowed').map(t => t.name), ['slack_read_channel', 'slack_send_message_draft']);
  assert.deepEqual(filterTools(sample, 'Drafts & Sent', 'all').map(t => t.name), ['slack_send_message_draft']);
  assert.deepEqual(filterTools(sample, 'immediately', 'writes').map(t => t.name), ['slack_send_message']);
  assert.deepEqual(filterTools(sample, 'immediately', 'allowed'), []);
});

test('summarizeTools counts totals, allowed, writes, writesAllowed, and custom overrides', () => {
  assert.deepEqual(summarizeTools(sample), {
    total: 4,
    allowed: 2,
    writes: 2,
    writesAllowed: 1,
    custom: 2,
  });
});

test('pickDefaultProfile prefers global default, then healthy project default, then healthy profile', () => {
  const broken = new Map([['alpha', { list: [], error: 'Not signed in' }], ['beta', { list: ['Slack'], error: null }]]);
  assert.equal(pickDefaultProfile(['alpha', 'beta', 'gamma'], 'gamma', [], broken), 'gamma');
  assert.equal(pickDefaultProfile(['alpha', 'beta', 'gamma'], 'off', [{ choice: 'alpha' }, { choice: 'beta' }], broken), 'beta');
  assert.equal(pickDefaultProfile(['alpha', 'beta'], 'off', [], broken), 'beta');
  assert.equal(pickDefaultProfile(['alpha'], 'off', [], broken), 'alpha');
  assert.equal(pickDefaultProfile([], 'off', [], broken), '');
});
