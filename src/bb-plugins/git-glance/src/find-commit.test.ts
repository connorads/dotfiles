import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { findCommit } from './find-commit.ts';

function repository(name: string) {
  const root = join(tempDir(), name);
  mkdirSync(root); git(root, 'init', '-q');
  writeFileSync(join(root, 'note.txt'), name);
  git(root, 'add', 'note.txt'); git(root, 'commit', '-qm', name);
  return { root, sha: git(root, 'rev-parse', 'HEAD').trim() };
}

test('finds a commit outside the selected repository without changing Git state', async () => {
  const selected = repository('alpha'); const target = repository('beta');
  const before = git(selected.root, 'rev-parse', 'HEAD');
  const index = git(target.root, 'write-tree');
  assert.deepEqual(await findCommit([selected.root, target.root], target.sha.slice(0, 7)), {
    matches: [{ root: target.root, sha: target.sha }], unchecked: 0,
  });
  assert.equal(git(selected.root, 'rev-parse', 'HEAD'), before);
  assert.equal(git(target.root, 'write-tree'), index);
});

test('returns every matching checkout and removes aliases of the same root', async () => {
  const target = repository('alpha');
  mkdirSync(join(target.root, 'nested'));
  const copy = join(tempDir(), 'copy'); git(target.root, 'clone', '-q', target.root, copy);
  const result = await findCommit([target.root, target.root, join(target.root, 'nested'), copy], target.sha);
  assert.deepEqual(result, { matches: [{ root: target.root, sha: target.sha }, { root: copy, sha: target.sha }], unchecked: 0 });
});

test('ordinary project folders are not failed Git candidates', async () => {
  const folder = tempDir();
  assert.deepEqual(await findCommit([folder], 'abcdef1'), { matches: [], unchecked: 0 });
  mkdirSync(join(folder, '.git'));
  assert.deepEqual(await findCommit([folder], 'abcdef1'), { matches: [], unchecked: 1 });
});

test('cancellation stops a running Git lookup', async () => {
  const folder = tempDir(); const bin = tempDir(); const path = process.env.PATH;
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec /bin/sleep 4\n'); chmodSync(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}:${path}`;
  const start = performance.now();
  try {
    assert.deepEqual(await findCommit([folder], 'abcdef1', AbortSignal.timeout(50)), { matches: [], unchecked: 1 });
    assert.ok(performance.now() - start < 1500);
  } finally { process.env.PATH = path; }
});

test('missing commits differ from unreadable repositories and cancelled searches', async () => {
  const target = repository('alpha');
  assert.deepEqual(await findCommit([target.root], '0000000'), { matches: [], unchecked: 0 });
  const gone = target.root; renameSync(gone, gone + '-moved');
  assert.deepEqual(await findCommit([gone], target.sha), { matches: [], unchecked: 1 });
  assert.deepEqual(await findCommit([gone, gone + '-moved'], target.sha, AbortSignal.abort()), { matches: [], unchecked: 2 });
});

test('accepts registered worktrees and refuses non-commit objects', async () => {
  const target = repository('alpha'); const worktree = join(tempDir(), 'review');
  git(target.root, 'worktree', 'add', '-q', '--detach', worktree);
  assert.deepEqual((await findCommit([worktree], target.sha)).matches, [{ root: worktree, sha: target.sha }]);
  const tree = git(target.root, 'rev-parse', 'HEAD^{tree}').trim();
  assert.deepEqual(await findCommit([target.root], tree), { matches: [], unchecked: 0 });
});
