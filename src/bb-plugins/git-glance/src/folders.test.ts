import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { browseFolders, findRepositories, resolveCheckout, selectFolder } from './folders.ts';

test('browsing marks repository roots and supports nested folders', async () => {
  const base = tempDir();
  const repo = join(base, 'app');
  mkdirSync(repo); fixtureGit(repo, 'init', '-q');
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(base, 'group'));
  mkdirSync(join(base, '.cache'));
  mkdirSync(join(base, '.config-repo')); fixtureGit(join(base, '.config-repo'), 'init', '-q');
  writeFileSync(join(base, 'file'), 'x');
  const result = await browseFolders(base, '.');
  assert.deepEqual(result.folders, [{ name: '.config-repo', repository: true }, { name: 'app', repository: true }, { name: 'group', repository: false }]);
  assert.equal((await browseFolders(base, 'app')).repository, true);
  assert.equal((await browseFolders(base, 'app/src')).repository, false);
  assert.equal(await selectFolder(base, 'app/src'), repo);
  await assert.rejects(selectFolder(base, 'group'), /not a git repository/);
  assert.equal(await resolveCheckout(repo), repo);
  await assert.rejects(resolveCheckout(join(repo, 'src')), /checkout root/);
  await assert.rejects(resolveCheckout('app'), /absolute/);
  await assert.rejects(resolveCheckout(join(base, 'group')), /checkout root/);
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
  assert.equal(await resolveCheckout(linked), linked);
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

test('repository search finds nested repositories and stops below each one', async () => {
  const base = tempDir();
  for (const path of ['web', 'services/api', 'services/billing', 'clients/acme/portal']) {
    mkdirSync(join(base, path), { recursive: true }); fixtureGit(join(base, path), 'init', '-q');
  }
  mkdirSync(join(base, 'web/packages/inner'), { recursive: true }); fixtureGit(join(base, 'web/packages/inner'), 'init', '-q');
  mkdirSync(join(base, 'node_modules/dep'), { recursive: true }); fixtureGit(join(base, 'node_modules/dep'), 'init', '-q');
  mkdirSync(join(base, '.cache/hidden'), { recursive: true }); fixtureGit(join(base, '.cache/hidden'), 'init', '-q');
  mkdirSync(join(base, 'services/.github')); fixtureGit(join(base, 'services/.github'), 'init', '-q');
  const outside = tempDir(); fixtureGit(outside, 'init', '-q');
  symlinkSync(outside, join(base, 'linked'));
  assert.deepEqual(await findRepositories(base, '.'), {
    repositories: ['clients/acme/portal', 'services/.github', 'services/api', 'services/billing', 'web'], truncated: false,
  });
  assert.deepEqual(await findRepositories(base, 'services'), { repositories: ['.github', 'api', 'billing'], truncated: false });
  assert.equal(await selectFolder(base, 'clients/acme/portal'), join(base, 'clients/acme/portal'));
  await assert.rejects(findRepositories(base, 'linked'), /outside/);
});

test('repository search stops at four levels and reports exhausted budgets', async () => {
  const base = tempDir();
  for (const path of ['a/b/c/four', 'a/b/c/d/five']) { mkdirSync(join(base, path), { recursive: true }); fixtureGit(join(base, path), 'init', '-q'); }
  assert.deepEqual(await findRepositories(base, '.'), { repositories: ['a/b/c/four'], truncated: false });
  for (const name of ['one', 'two', 'three']) { mkdirSync(join(base, name)); fixtureGit(join(base, name), 'init', '-q'); }
  assert.deepEqual(await findRepositories(base, '.', { limit: 2 }), { repositories: ['one', 'three'], truncated: true });
  assert.deepEqual(await findRepositories(base, '.', { folders: 1 }), { repositories: ['one', 'three', 'two'], truncated: true });
});
