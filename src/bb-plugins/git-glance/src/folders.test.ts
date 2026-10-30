import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { browseFolders, selectFolder } from './folders.ts';

test('browsing marks repository roots and supports nested folders', async () => {
  const base = tempDir();
  const repo = join(base, 'app');
  mkdirSync(repo); fixtureGit(repo, 'init', '-q');
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(base, 'group'));
  writeFileSync(join(base, 'file'), 'x');
  const result = await browseFolders(base, '.');
  assert.deepEqual(result.folders, [{ name: 'app', repository: true }, { name: 'group', repository: false }]);
  assert.equal((await browseFolders(base, 'app')).repository, true);
  assert.equal((await browseFolders(base, 'app/src')).repository, false);
  assert.equal(await selectFolder(base, 'app/src'), repo);
  await assert.rejects(selectFolder(base, 'group'), /not a git repository/);
});

test('browsing and selection reject paths outside the checkout, including symlinks', async () => {
  const base = tempDir();
  const outside = tempDir(); fixtureGit(outside, 'init', '-q');
  symlinkSync(outside, join(base, 'escape'));
  await assert.rejects(browseFolders(base, '../'), /outside/);
  await assert.rejects(browseFolders(base, 'escape'), /outside/);
  await assert.rejects(selectFolder(base, 'escape'), /outside/);
  assert.deepEqual((await browseFolders(base, '.')).folders, []);
});

test('repository browsing lists external worktrees and selection verifies membership', async () => {
  const base = tempDir();
  const repo = join(base, 'app');
  mkdirSync(repo); fixtureGit(repo, 'init', '-q');
  fixtureGit(repo, 'commit', '--allow-empty', '-qm', 'Initial');
  const outside = tempDir();
  const linked = join(outside, 'review tree');
  const detached = join(outside, 'detached');
  fixtureGit(repo, 'worktree', 'add', '-qb', 'review', linked);
  fixtureGit(repo, 'worktree', 'add', '-q', '--detach', detached);
  assert.deepEqual((await browseFolders(base, 'app')).worktrees, [
    { path: repo, branch: 'main' },
    { path: detached, branch: null },
    { path: linked, branch: 'review' },
  ]);
  assert.equal(await selectFolder(base, 'app', linked), linked);
  assert.equal(await selectFolder(base, 'app', detached), detached);
  const unrelated = join(outside, 'other');
  mkdirSync(unrelated); fixtureGit(unrelated, 'init', '-q');
  await assert.rejects(selectFolder(base, 'app', unrelated), /registered worktree/);
  await assert.rejects(selectFolder(base, 'app', join(linked, 'missing')), /registered worktree/);
  await assert.rejects(selectFolder(base, linked), /outside/);
  renameSync(detached, join(outside, 'moved'));
  assert.equal((await browseFolders(base, 'app')).worktrees.some(tree => tree.path === detached), false);
  await assert.rejects(selectFolder(base, 'app', detached), /registered worktree/);
  mkdirSync(detached); fixtureGit(detached, 'init', '-q');
  await assert.rejects(selectFolder(base, 'app', detached), /another repository/);
});
