import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinStats, parseStatusPaths, parseUntracked } from './stat.ts';

test('name-status and numstat join per file, including renames and binaries', () => {
  const names = ['M', 'src/a.ts', 'R087', 'old.ts', 'new.ts', 'D', 'gone.md', 'A', 'logo.png', 'C100', 'a.txt', 'c.txt', 'T', 'link', ''].join('\0');
  const counts = ['3\t1\tsrc/a.ts', '2\t2\t', 'old.ts', 'new.ts', '0\t4\tgone.md', '-\t-\tlogo.png', '0\t0\t', 'a.txt', 'c.txt', '1\t1\tlink', ''].join('\0');
  assert.deepEqual(joinStats(names, counts), [
    { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 3, deletions: 1, binary: false, untracked: false },
    { path: 'new.ts', oldPath: 'old.ts', status: 'renamed', additions: 2, deletions: 2, binary: false, untracked: false },
    { path: 'gone.md', oldPath: null, status: 'deleted', additions: 0, deletions: 4, binary: false, untracked: false },
    { path: 'logo.png', oldPath: null, status: 'added', additions: null, deletions: null, binary: true, untracked: false },
    { path: 'c.txt', oldPath: 'a.txt', status: 'copied', additions: 0, deletions: 0, binary: false, untracked: false },
    { path: 'link', oldPath: null, status: 'modified', additions: 1, deletions: 1, binary: false, untracked: false },
  ]);
});

test('a stat-only change listed by name-status but not numstat drops out', () => {
  assert.deepEqual(joinStats('M\0touched.ts\0M\0edited.ts\0', '1\t1\tedited.ts\0').map(e => e.path), ['edited.ts']);
});

test('paths with tabs and newlines survive -z', () => {
  assert.deepEqual(joinStats('M\0a\tb\nc\0', '1\t0\ta\tb\nc\0').map(e => [e.path, e.additions]), [['a\tb\nc', 1]]);
});

test('untracked listing drops nested repositories', () => {
  assert.deepEqual(parseUntracked('new.md\0vendor/repo/\0dir/x.ts\0').map(e => [e.path, e.untracked, e.status]),
    [['new.md', true, 'added'], ['dir/x.ts', true, 'added']]);
});

test('status paths: changed, renamed, unmerged and untracked, skipping headers and rename sources', () => {
  const status = [
    '# branch.oid 0123', '# branch.head main',
    '1 .M N... 100644 100644 100644 aaa aaa a b.txt',
    '2 R. N... 100644 100644 100644 aaa aaa R100 new name.ts', 'old.ts',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.md',
    '? fresh.txt', '',
  ].join('\0');
  assert.deepEqual(parseStatusPaths(status), ['a b.txt', 'new name.ts', 'conflict.md', 'fresh.txt']);
});
