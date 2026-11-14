import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, diffBlocks, freshKeys, plural, splitPath } from './format.ts';

test('age shortens recent times and dates older ones', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const at = (seconds: number) => now / 1000 - seconds;
  assert.deepEqual([at(3), at(42), at(300), at(7200), at(3 * 86_400)].map(t => age(t, now)), ['now', '42s', '5m', '2h', '3d']);
  assert.equal(age(Date.UTC(2026, 2, 4) / 1000, now), '4 Mar');
  assert.equal(age(Date.UTC(2024, 2, 4) / 1000, now), '4 Mar 24');
});

test('diff blocks scale with size and keep both colours visible', () => {
  assert.deepEqual(diffBlocks(0, 0), ['neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
  assert.deepEqual(diffBlocks(1, 0), ['added', 'neutral', 'neutral', 'neutral', 'neutral']);
  assert.deepEqual(diffBlocks(400, 1), ['added', 'added', 'added', 'added', 'removed']);
  assert.deepEqual(diffBlocks(10, 10), ['added', 'added', 'removed', 'neutral', 'neutral']);
});

test('paths split into directory and name, including untracked directories', () => {
  assert.deepEqual(splitPath('a/b/c.ts'), { dir: 'a/b/', name: 'c.ts' });
  assert.deepEqual(splitPath('c.ts'), { dir: '', name: 'c.ts' });
  assert.deepEqual(splitPath('src/spikes/'), { dir: 'src/', name: 'spikes/' });
});

test('fresh keys are those added or changed since the previous render, never on the first', () => {
  const next = new Map([['a', '1/0'], ['b', '2/0'], ['c', '0/1']]);
  assert.deepEqual([...freshKeys(null, next)], []);
  assert.deepEqual([...freshKeys(new Map([['a', '1/0'], ['b', '1/0']]), next)], ['b', 'c']);
});

test('plural takes an irregular plural form', () => {
  assert.deepEqual([plural(1, 'file'), plural(2, 'file')], ['1 file', '2 files']);
  assert.deepEqual([plural(1, 'stash', 'stashes'), plural(2, 'stash', 'stashes')], ['1 stash', '2 stashes']);
});
