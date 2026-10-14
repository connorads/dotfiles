import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
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
