import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENTION_PROVIDER_ID, decodeMentionId, encodeMentionId, mentionItems, pillParts } from './mention.ts';
import { parseListLines } from './rows.ts';

test('a pill id round-trips host and ref, including refs with slashes and colons', () => {
  for (const ref of ['mine/tdd', 'expo/', 'odd/na:me']) {
    assert.deepEqual(decodeMentionId(encodeMentionId({ hostId: 'host-1', ref })), { hostId: 'host-1', ref });
  }
});

test('malformed pill ids decode to null', () => {
  for (const id of ['', 'no-separator', '|mine/tdd', 'host|']) assert.equal(decodeMentionId(id), null);
});

test('pills are space-separated and labelled with the ref', () => {
  assert.deepEqual(pillParts('h', ['mine/tdd', 'expo/']), [
    { provider: MENTION_PROVIDER_ID, id: 'h|mine/tdd', label: 'mine/tdd' }, ' ',
    { provider: MENTION_PROVIDER_ID, id: 'h|expo/', label: 'expo/' }, ' ',
  ]);
});

test('mention items describe folders by size, cap descriptions and respect the limit', () => {
  const rows = parseListLines(['mine/  (1)', `mine/long  ${'x'.repeat(200)}`, 'mine/bare']);
  const items = mentionItems('h', rows, 2);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: 'h|mine/', title: 'mine/', subtitle: '1 skill' });
  assert.equal(items[1]?.subtitle?.length, 120);
  assert.deepEqual(mentionItems('h', rows.slice(2), 5), [{ id: 'h|mine/bare', title: 'mine/bare' }]);
});
