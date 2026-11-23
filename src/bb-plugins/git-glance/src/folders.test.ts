import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { browseFolders, findRepositories, resolveCheckout, selectFolder } from './folders.ts';

test('browsing marks repository roots and supports nested folders', async () => {
  const base = tempDir();
  const home = tempDir();
  const repo = join(base, 'app');
  mkdirSync(repo); fixtureGit(repo, 'init', '-q');
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(base, 'group'));
  mkdirSync(join(base, '.cache'));
  mkdirSync(join(base, '.config-repo')); fixtureGit(join(base, '.config-repo'), 'init', '-q');
  writeFileSync(join(base, 'file'), 'x');
  const result = await browseFolders(base, '.', home);
  assert.deepEqual(result.folders, [{ name: '.config-repo', repository: true }, { name: 'app', repository: true }, { name: 'group', repository: false }]);
  assert.equal(result.base, base);
  assert.equal(result.home, home);
  assert.equal(result.parent, dirname(base));
  assert.equal(result.dotfiles, false);
  assert.equal(result.repoKind, null);
  const appBrowse = await browseFolders(base, 'app', home);
  assert.equal(appBrowse.repository, true);
  assert.equal(appBrowse.repoKind, 'repo');
  assert.equal((await browseFolders(base, 'app/src', home)).repository, false);
  assert.equal(await selectFolder(base, 'app/src', undefined, home), repo);
  await assert.rejects(selectFolder(base, 'group', undefined, home), /not a git repository/);
  assert.equal(await resolveCheckout(repo, home), repo);
  await assert.rejects(resolveCheckout(join(repo, 'src'), home), /checkout root/);
  await assert.rejects(resolveCheckout('app', home), /absolute/);
  await assert.rejects(resolveCheckout(join(base, 'group'), home), /checkout root/);
  await assert.rejects(browseFolders(base, 'missing', home), /Folder not found/);
  await assert.rejects(browseFolders(base, 'file', home), /Not a folder/);
});

test('browsing and selection can escape above the thread folder, reach Home and dotfiles, and skip symlink entries', async () => {
  const root = tempDir();
  const home = join(root, 'home');
  const base = join(home, '.bb', 'workspaces', 'thr_1');
  const outsideRepo = join(root, 'external-repo');
  const homeRepo = join(home, 'src', 'tool');
  mkdirSync(base, { recursive: true });
  mkdirSync(homeRepo, { recursive: true }); fixtureGit(homeRepo, 'init', '-q');
  mkdirSync(outsideRepo, { recursive: true }); fixtureGit(outsideRepo, 'init', '-q');
  mkdirSync(join(home, 'git', 'dotfiles'), { recursive: true });
  fixtureGit(join(home, 'git', 'dotfiles'), 'init', '--bare', '-q');
  symlinkSync(outsideRepo, join(base, 'linked'));

  // Symlink entries are still omitted from subfolder listings.
  assert.deepEqual((await browseFolders(base, '.', home)).folders, []);

  // Climbing up via .. reaches parent folders and eventually Home.
  const up = await browseFolders(base, '..', home);
  assert.equal(up.root, join(home, '.bb', 'workspaces'));
  assert.equal(up.dotfiles, true);

  // ~ expands to Home and exposes the bare dotfiles repository.
  const atHome = await browseFolders(base, '~', home);
  assert.equal(atHome.root, home);
  assert.equal(atHome.repository, true);
  assert.equal(atHome.repoKind, 'dotfiles');
  assert.equal(atHome.dotfiles, true);
  assert.equal(await selectFolder(base, '~', undefined, home), home);
  assert.equal(await selectFolder(base, '~/src/tool', undefined, home), homeRepo);
  assert.equal(await selectFolder(base, outsideRepo, undefined, home), outsideRepo);

  // Viewing Home from its parent marks Home as a repository when dotfiles exists.
  const aboveHome = await browseFolders(base, root, home);
  assert.deepEqual(aboveHome.folders, [
    { name: 'external-repo', repository: true },
    { name: 'home', repository: true },
  ]);

  // Deep repository search works inside Home, and skips outside both base and Home.
  assert.deepEqual(await findRepositories(base, '~', { home }), { repositories: ['src/tool'], truncated: false });
  assert.deepEqual(await findRepositories(base, root, { home }), { repositories: [], truncated: false, skipped: true });
});

test('repository browsing lists external worktrees and selection verifies membership', async () => {
  const base = tempDir();
  const home = tempDir();
  const repo = join(base, 'app');
  mkdirSync(repo); fixtureGit(repo, 'init', '-q');
  fixtureGit(repo, 'commit', '--allow-empty', '-qm', 'Initial');
  const outside = tempDir();
  const linked = join(outside, 'review tree');
  const detached = join(outside, 'detached');
  fixtureGit(repo, 'worktree', 'add', '-qb', 'review', linked);
  fixtureGit(repo, 'worktree', 'add', '-q', '--detach', detached);
  assert.deepEqual((await browseFolders(base, 'app', home)).worktrees, [
    { path: repo, branch: 'main' },
    { path: detached, branch: null },
    { path: linked, branch: 'review' },
  ]);
  assert.equal(await selectFolder(base, 'app', linked, home), linked);
  assert.equal(await resolveCheckout(linked, home), linked);
  assert.equal(await selectFolder(base, 'app', detached, home), detached);
  const unrelated = join(outside, 'other');
  mkdirSync(unrelated); fixtureGit(unrelated, 'init', '-q');
  await assert.rejects(selectFolder(base, 'app', unrelated, home), /registered worktree/);
  await assert.rejects(selectFolder(base, 'app', join(linked, 'missing'), home), /registered worktree/);
  renameSync(detached, join(outside, 'moved'));
  assert.equal((await browseFolders(base, 'app', home)).worktrees.some(tree => tree.path === detached), false);
  await assert.rejects(selectFolder(base, 'app', detached, home), /registered worktree/);
  mkdirSync(detached); fixtureGit(detached, 'init', '-q');
  await assert.rejects(selectFolder(base, 'app', detached, home), /another repository/);
});

test('repository search finds nested repositories and stops below each one', async () => {
  const base = tempDir();
  const home = tempDir();
  for (const path of ['web', 'services/api', 'services/billing', 'clients/acme/portal']) {
    mkdirSync(join(base, path), { recursive: true }); fixtureGit(join(base, path), 'init', '-q');
  }
  mkdirSync(join(base, 'web/packages/inner'), { recursive: true }); fixtureGit(join(base, 'web/packages/inner'), 'init', '-q');
  mkdirSync(join(base, 'node_modules/dep'), { recursive: true }); fixtureGit(join(base, 'node_modules/dep'), 'init', '-q');
  mkdirSync(join(base, '.cache/hidden'), { recursive: true }); fixtureGit(join(base, '.cache/hidden'), 'init', '-q');
  mkdirSync(join(base, 'services/.github')); fixtureGit(join(base, 'services/.github'), 'init', '-q');
  const outside = tempDir(); fixtureGit(outside, 'init', '-q');
  symlinkSync(outside, join(base, 'linked'));
  assert.deepEqual(await findRepositories(base, '.', { home }), {
    repositories: ['clients/acme/portal', 'services/.github', 'services/api', 'services/billing', 'web'], truncated: false,
  });
  assert.deepEqual(await findRepositories(base, 'services', { home }), { repositories: ['.github', 'api', 'billing'], truncated: false });
  assert.equal(await selectFolder(base, 'clients/acme/portal', undefined, home), join(base, 'clients/acme/portal'));
  assert.deepEqual(await findRepositories(base, 'linked', { home }), { repositories: [], truncated: false, skipped: true });
});

test('repository search stops at four levels and reports exhausted budgets', async () => {
  const base = tempDir();
  const home = tempDir();
  for (const path of ['a/b/c/four', 'a/b/c/d/five']) { mkdirSync(join(base, path), { recursive: true }); fixtureGit(join(base, path), 'init', '-q'); }
  assert.deepEqual(await findRepositories(base, '.', { home }), { repositories: ['a/b/c/four'], truncated: false });
  for (const name of ['one', 'two', 'three']) { mkdirSync(join(base, name)); fixtureGit(join(base, name), 'init', '-q'); }
  assert.deepEqual(await findRepositories(base, '.', { limit: 2, home }), { repositories: ['one', 'three'], truncated: true });
  assert.deepEqual(await findRepositories(base, '.', { folders: 1, home }), { repositories: ['one', 'three', 'two'], truncated: true });
});
