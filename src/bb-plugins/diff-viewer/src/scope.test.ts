import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  branchNote, commitSpec, logArgv, parseLog, patchArgv, pickDefaultBranch, statArgv, unpushedTip, untrackedArgv,
} from './scope.ts';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);

test('working-tree and commit specs become diff argv with paths after --', () => {
  assert.deepEqual(patchArgv({ from: a, to: null, untracked: true }, ['-x.ts', 'b c.md']),
    ['diff', '--no-color', '--no-ext-diff', '--no-relative', '--submodule=short', '-M', '--src-prefix=a/', '--dst-prefix=b/', a, '--', '-x.ts', 'b c.md']);
  assert.deepEqual(statArgv({ from: a, to: b, untracked: false }, '--numstat'),
    ['diff', '--numstat', '-z', '-M', '--no-ext-diff', '--no-relative', a, b, '--']);
  assert.deepEqual(untrackedArgv('-rf'), ['diff', '--no-color', '--no-ext-diff', '--no-relative', '--submodule=short', '-M', '--src-prefix=a/', '--dst-prefix=b/', '--no-index', '--', '/dev/null', '-rf']);
  assert.deepEqual(logArgv(a), ['log', '--no-show-signature', '--format=%H%x1f%h%x1f%ct%x1f%s%x1e', '--max-count=200', `${a}..HEAD`, '--']);
});

test('unpushed starts at the upstream, else origin/HEAD, else nowhere', () => {
  assert.deepEqual(unpushedTip({ upstream: 'origin/feature', originHead: a }), { ref: '@{upstream}', label: 'origin/feature' });
  assert.deepEqual(unpushedTip({ upstream: null, originHead: a }), { ref: 'origin/HEAD', label: 'origin/HEAD' });
  assert.equal(unpushedTip({ upstream: null, originHead: null }), null);
});

test('default branch: origin/HEAD first, then origin and local main or master', () => {
  assert.equal(pickDefaultBranch('refs/remotes/origin/trunk', new Set(['refs/heads/main'])), 'refs/remotes/origin/trunk');
  assert.equal(pickDefaultBranch(null, new Set(['refs/heads/main', 'refs/remotes/origin/master'])), 'refs/remotes/origin/master');
  assert.equal(pickDefaultBranch(null, new Set(['refs/heads/master'])), 'refs/heads/master');
  assert.equal(pickDefaultBranch(null, new Set()), null);
});

test('branch note says when Branch adds nothing over the other scopes', () => {
  const main = 'refs/remotes/origin/main';
  assert.equal(branchNote({ branchBase: a, unpushedBase: a, head: a, defaultBranch: main }), 'No commits since origin/main: Branch equals Uncommitted.');
  assert.equal(branchNote({ branchBase: a, unpushedBase: a, head: b, defaultBranch: main }),
    'origin/main and the upstream share a base: Branch equals Unpushed plus uncommitted changes.');
  assert.equal(branchNote({ branchBase: a, unpushedBase: c, head: b, defaultBranch: main }), null);
  assert.equal(branchNote({ branchBase: a, unpushedBase: null, head: b, defaultBranch: 'refs/heads/main' }), null);
});

test('one commit compares with its first parent, a root commit with the empty tree', () => {
  assert.deepEqual(commitSpec(b, a, c), { from: a, to: b, untracked: false });
  assert.deepEqual(commitSpec(b, null, c), { from: c, to: b, untracked: false });
});

test('log records split on separators, keeping odd subjects intact', () => {
  assert.deepEqual(parseLog(`${a}\x1fa1\x1f100\x1ffix: thing\x1e\n${b}\x1fb1\x1f90\x1f\x1e`), [
    { sha: a, shortSha: 'a1', time: 100, subject: 'fix: thing' },
    { sha: b, shortSha: 'b1', time: 90, subject: '' },
  ]);
});
