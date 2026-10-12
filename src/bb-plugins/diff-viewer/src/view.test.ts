import assert from 'node:assert/strict';
import { test } from 'node:test';
import { age, currentFile, defaultCollapsed, neighbour, splitPath, totals } from './view.ts';

test('lockfiles and deletions start collapsed', () => {
  assert.equal(defaultCollapsed({ lockfile: true, status: 'modified' }), true);
  assert.equal(defaultCollapsed({ lockfile: false, status: 'deleted' }), true);
  assert.equal(defaultCollapsed({ lockfile: false, status: 'renamed' }), false);
});

test('totals skip unknown counts', () => {
  assert.deepEqual(totals([{ additions: 3, deletions: 1 }, { additions: null, deletions: null }, { additions: 2, deletions: 0 }]), { additions: 5, deletions: 1 });
});

test('paths split into a dimmed directory and a name', () => {
  assert.deepEqual(splitPath('src/lib/a.ts'), { dir: 'src/lib/', name: 'a.ts' });
  assert.deepEqual(splitPath('README.md'), { dir: '', name: 'README.md' });
});

test('next and previous file from the scroll position', () => {
  const tops = [100, 300, 900];
  assert.equal(neighbour(tops, 0, 1), 0, 'from the index, next is the first file');
  assert.equal(neighbour(tops, 0, -1), null);
  assert.equal(neighbour(tops, 100, 1), 1);
  assert.equal(neighbour(tops, 100, -1), 0);
  assert.equal(neighbour(tops, 500, -1), 1, 'inside a file, back goes to its top');
  assert.equal(neighbour(tops, 300, -1), 0);
  assert.equal(neighbour(tops, 950, 1), 2, 'the last file stays put');
  assert.equal(neighbour([], 0, 1), null);
  assert.deepEqual([currentFile(tops, 0), currentFile(tops, 500), currentFile(tops, 2000)], [-1, 1, 2]);
});

test('commit age in minutes, hours or days', () => {
  const now = 1_000_000 * 1000;
  assert.equal(age(1_000_000 - 120, now), '2m');
  assert.equal(age(1_000_000 - 3 * 3600, now), '3h');
  assert.equal(age(1_000_000 - 2 * 86400, now), '2d');
});
