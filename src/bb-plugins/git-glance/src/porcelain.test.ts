import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { logFormat, parseLog, parseNameStatus, parseNumstat, parseStatus, withStats } from './porcelain.ts';

function repo() {
  const dir = tempDir();
  const git = (...args: string[]) => fixtureGit(dir, ...args);
  git('init', '-q');
  return { dir, git, write: (path: string, text: string) => writeFileSync(join(dir, path), text) };
}

test('status splits one file into staged and unstaged changes and keeps renames', () => {
  const { dir, git, write } = repo();
  write('a.txt', 'one\n'); write('old name.txt', 'x\n');
  git('add', '.'); git('commit', '-qm', 'init');
  write('a.txt', 'one\ntwo\n'); git('add', 'a.txt'); write('a.txt', 'one\ntwo\nthree\n');
  renameSync(join(dir, 'old name.txt'), join(dir, 'new name.txt')); git('add', '-A', '--', 'old name.txt', 'new name.txt');
  write('fresh.txt', 'new\n');
  const status = parseStatus(git('status', '--porcelain=v2', '--branch', '--show-stash', '-z'));
  assert.equal(status.branch.head, 'main');
  assert.equal(status.branch.upstream, null);
  assert.deepEqual(status.changes.map(c => [c.area, c.code, c.path, c.origPath]), [
    ['staged', 'M', 'a.txt', null],
    ['unstaged', 'M', 'a.txt', null],
    ['staged', 'R', 'new name.txt', 'old name.txt'],
    ['untracked', '?', 'fresh.txt', null],
  ]);
  const staged = parseNumstat(git('diff', '--cached', '--numstat', '-z'));
  const unstaged = parseNumstat(git('diff', '--numstat', '-z'));
  const counted = withStats(status.changes, staged, unstaged);
  assert.deepEqual(counted.slice(0, 3).map(c => [c.added, c.removed]), [[1, 0], [1, 0], [0, 0]]);
});

test('status reports detached heads, unborn branches, ahead/behind and stashes', () => {
  assert.deepEqual(parseStatus('# branch.oid (initial)\0# branch.head main\0').branch,
    { head: 'main', oid: null, upstream: null, ahead: 0, behind: 0 });
  const status = parseStatus('# branch.oid abc\0# branch.head (detached)\0# branch.upstream origin/main\0# branch.ab +3 -1\0# stash 2\0');
  assert.deepEqual(status.branch, { head: null, oid: 'abc', upstream: 'origin/main', ahead: 3, behind: 1 });
  assert.equal(status.stash, 2);
});

test('status marks merge conflicts once', () => {
  const { git, write } = repo();
  write('f.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'other'); write('f.txt', 'other\n'); git('commit', '-qam', 'other');
  git('checkout', '-q', 'main'); write('f.txt', 'main\n'); git('commit', '-qam', 'main');
  try { git('merge', '-q', 'other'); } catch { /* conflict expected */ }
  const status = parseStatus(git('status', '--porcelain=v2', '-z'));
  assert.deepEqual(status.changes.map(c => [c.area, c.code, c.path]), [['conflicted', 'U', 'f.txt']]);
});

test('numstat reports binary files as null', () => {
  assert.deepEqual([...parseNumstat('-\t-\timage.png\0').entries()], [['image.png', { added: null, removed: null }]]);
});

test('log keeps parents, subjects with separators and classifies refs', () => {
  const { git, write } = repo();
  write('f.txt', '1\n'); git('add', '.'); git('commit', '-qm', 'first');
  git('tag', 'v1'); git('branch', 'feature/x');
  write('f.txt', '2\n'); git('commit', '-qam', 'second: with, commas');
  const commits = parseLog(git('log', '--decorate=full', `--format=${logFormat}`));
  assert.deepEqual(commits.map(c => [c.subject, c.parents.length, c.refs]), [
    ['second: with, commas', 1, [{ name: 'main', kind: 'head' }]],
    ['first', 0, [{ name: 'v1', kind: 'tag' }, { name: 'feature/x', kind: 'local' }]],
  ]);
  assert.ok(commits[0]!.time > 1_600_000_000);
});

test('log separates remote branches from local branches with slashes', () => {
  const [commit] = parseLog('a\x1f\x1fMe\x1f1\x1fHEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/fix/y\x1fs\x1e');
  assert.deepEqual(commit!.refs, [
    { name: 'main', kind: 'head' }, { name: 'origin/main', kind: 'remote' }, { name: 'fix/y', kind: 'local' },
  ]);
});

test('name-status keeps both paths of a rename and maps codes', () => {
  assert.deepEqual(parseNameStatus('M\0a.ts\0R087\0old name.ts\0new name.ts\0A\0b.ts\0D\0c.ts\0'), [
    { path: 'a.ts', origPath: null, code: 'M' },
    { path: 'new name.ts', origPath: 'old name.ts', code: 'R' },
    { path: 'b.ts', origPath: null, code: 'A' },
    { path: 'c.ts', origPath: null, code: 'D' },
  ]);
});
