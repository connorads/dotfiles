import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import type { Snapshot } from '../contracts.ts';
import { createMonitor, type Watch, type WatchEvent } from './monitor.ts';
import { resolveRepo } from './repo.ts';

const git = fixtureGit;
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
/** Waits for a refresh to land instead of guessing how long one takes under load. */
async function until(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a refresh');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function setup() {
  const dir = tempDir();
  git(dir, 'init', '-q');
  writeFileSync(join(dir, '.gitignore'), 'build/\n');
  mkdirSync(join(dir, 'build')); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), '1\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  const watches: { rootPath: string; ignoredPaths: readonly string[]; listener: (event: WatchEvent) => void | Promise<void> }[] = [];
  const watch: Watch = async (options, listener) => {
    watches.push({ rootPath: options.rootPath, ignoredPaths: options.ignoredPaths ?? [], listener });
    return { dispose: async () => {} };
  };
  const published: Snapshot[] = [];
  const monitor = await createMonitor((await resolveRepo(dir))!, { watch, publish: s => published.push(s), log: () => {} });
  const fire = async (root: string, ...paths: string[]) => {
    // The listener awaits its own filtering, so a change it ignores has been ignored by now.
    await watches.find(w => w.rootPath === root)!.listener({ kind: 'changed', changes: paths.map(path => ({ path: join(root, path) })) });
  };
  return { dir, gitDir: join(dir, '.git'), watches, published, monitor, fire };
}

test('watches the git dir and the work tree, skipping ignored top-level directories', async () => {
  const { dir, gitDir, watches } = await setup();
  assert.deepEqual(watches.map(w => w.rootPath).sort(), [dir, gitDir].sort());
  assert.deepEqual(watches.find(w => w.rootPath === dir)!.ignoredPaths, ['.git', 'build']);
  assert.ok(watches.find(w => w.rootPath === gitDir)!.ignoredPaths.includes('**/*.lock'));
});

test('a visible work-tree change publishes once; ignored paths and no-op changes do not', async () => {
  const { dir, published, fire } = await setup();
  writeFileSync(join(dir, 'build', 'out.js'), 'x');
  await fire(dir, 'build/out.js');
  assert.equal(published.length, 0);
  writeFileSync(join(dir, 'src', 'a.ts'), '2\n');
  await fire(dir, 'src/a.ts', 'src/a.ts', 'build/out.js');
  await until(() => published.length === 1);
  assert.equal(published[0]!.kind === 'repo' && published[0]!.changes[0]!.path, 'src/a.ts');
  await fire(dir, 'src/a.ts');
  await settle();
  assert.equal(published.length, 1, 'same snapshot is not republished');
});

test('lock files in the git dir are ignored; the renamed result is not', async () => {
  const { dir, gitDir, published, fire } = await setup();
  await fire(gitDir, 'index.lock', 'refs/heads/main.lock');
  assert.equal(published.length, 0);
  git(dir, 'switch', '-qc', 'feature');
  await fire(gitDir, 'HEAD');
  await until(() => published.length === 1);
  assert.equal(published[0]!.kind === 'repo' && published[0]!.branch.head, 'feature');
});

test('changes during a hold publish once on release', async () => {
  const { dir, gitDir, published, monitor, fire } = await setup();
  monitor.hold();
  git(dir, 'switch', '-qc', 'one'); await fire(gitDir, 'HEAD');
  git(dir, 'switch', '-qc', 'two'); await fire(gitDir, 'HEAD');
  await settle();
  assert.equal(published.length, 0);
  monitor.release();
  await until(() => published.length === 1);
  const now = monitor.current();
  assert.ok(now.kind === 'repo');
  assert.equal(now.branch.head, 'two');
});
