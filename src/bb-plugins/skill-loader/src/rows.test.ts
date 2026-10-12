import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandRefs, filterRows, groupRefs, parseListLines } from './rows.ts';

const listing = [
  'mine/  (2)',
  'mine/tdd  Test-first loop. Use when fixing bugs.',
  'mine/typescript  Idiomatic TS',
  'expo/  (1)',
  'expo/expo-router',
  '',
];

test('folder rows lead their block and carry the member count', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(rows.map(row => [row.kind, row.ref]), [
    ['folder', 'mine/'], ['skill', 'mine/tdd'], ['skill', 'mine/typescript'], ['folder', 'expo/'], ['skill', 'expo/expo-router'],
  ]);
  assert.deepEqual(rows[0], { kind: 'folder', ref: 'mine/', source: 'mine', count: 2 });
});

test('a skill row keeps its full description, and a bare row has none', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(rows[1], { kind: 'skill', ref: 'mine/tdd', source: 'mine', name: 'tdd', description: 'Test-first loop. Use when fixing bugs.' });
  assert.equal(rows[4]?.kind === 'skill' && rows[4].description, '');
});

test('lines without a source/ ref are dropped', () => {
  assert.deepEqual(parseListLines(['skl: warning something', '/odd']), []);
});

test('filter matches the ref as a subsequence and ignores the description', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(filterRows(rows, 'tdd').map(row => row.ref), ['mine/tdd']);
  assert.deepEqual(filterRows(rows, 'bugs').map(row => row.ref), []);
  assert.deepEqual(filterRows(rows, 'mn/ts').map(row => row.ref), ['mine/typescript']);
});

test('filtering by a source name keeps the folder row ahead of its members', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(filterRows(rows, 'EXPO').map(row => row.ref), ['expo/', 'expo/expo-router']);
});

test('tighter matches rank first, like fzf, so a loose subsequence cannot bury an exact name', () => {
  // Shape taken from the real catalogue: `prd` subsequence-matched 41 rows and
  // personal/prd fell out of the 30-row mention menu in list order.
  const rows = parseListLines([
    'private/  (2)', 'private/pr-description', 'private/reconcile-shared-expenses',
    'personal/  (1)', 'personal/prd', 'mine/  (1)', 'mine/prd-writer',
  ]);
  assert.deepEqual(filterRows(rows, 'prd').map(row => row.ref),
    ['personal/prd', 'mine/prd-writer', 'private/pr-description', 'private/reconcile-shared-expenses']);
});

test('a folder named by the query ranks first; a name prefix beats the source prefix; ties keep list order', () => {
  const rows = parseListLines(['expo/  (2)', 'expo/router', 'expo/eas-hosting', 'mine/expo-notes']);
  assert.deepEqual(filterRows(rows, 'expo').map(row => row.ref), ['expo/', 'mine/expo-notes', 'expo/router', 'expo/eas-hosting']);
});

test('every term must match', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(filterRows(rows, 'mine type').map(row => row.ref), ['mine/typescript']);
  assert.equal(filterRows(rows, '  ').length, rows.length);
});

test('a folder ref expands to its members without duplicates', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(expandRefs(['mine/tdd', 'mine/', 'expo/'], rows), {
    refs: ['mine/tdd', 'mine/typescript', 'expo/expo-router'], missing: [],
  });
});

test('unknown refs are reported, not silently dropped', () => {
  const rows = parseListLines(listing);
  assert.deepEqual(expandRefs(['mine/gone', 'nope/'], rows), { refs: [], missing: ['mine/gone', 'nope/'] });
});

test('group refs are the ones that need an install confirmation', () => {
  assert.deepEqual(groupRefs(['mine/tdd', 'expo/']), ['expo/']);
});
