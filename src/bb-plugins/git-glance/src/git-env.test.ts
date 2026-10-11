import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { diff, resolveRepo, snapshot } from './repo.ts';
import { sync } from './sync.ts';

/** Run `body` with the variables git exports to hooks pointing at `decoy`, as under a pre-commit hook. */
async function asIfInHook(decoy: string, body: () => Promise<void>) {
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  Object.assign(process.env, { GIT_DIR: join(decoy, '.git'), GIT_INDEX_FILE: join(decoy, '.git', 'index'), GIT_WORK_TREE: decoy });
  try { await body(); } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

test('hook variables never redirect git to another repository', async () => {
  const decoy = tempDir();
  git(decoy, 'init', '-q'); writeFileSync(join(decoy, 'd.txt'), 'decoy\n'); git(decoy, 'add', '.'); git(decoy, 'commit', '-qm', 'decoy');
  const decoyIndex = readFileSync(join(decoy, '.git', 'index'));
  const base = tempDir();
  git(base, 'init', '-q', '--bare', 'remote.git');
  const work = join(base, 'work');
  git(base, 'clone', '-q', 'remote.git', work);
  git(work, 'switch', '-qc', 'target');
  writeFileSync(join(work, 'f.txt'), '1\n'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'target');
  writeFileSync(join(work, 'f.txt'), '2\n');

  await asIfInHook(decoy, async () => {
    const repo = (await resolveRepo(work))!;
    assert.equal(repo.cwd, work);
    const result = await snapshot(repo);
    assert.ok(result.kind === 'repo');
    assert.equal(result.branch.head, 'target');
    assert.deepEqual(result.changes.map(c => c.path), ['f.txt']);
    assert.match((await diff(repo, { path: 'f.txt', origPath: null, source: { kind: 'work-tree', area: 'unstaged' } })).patch, /\+2/);
    const pushed = await sync(repo, 'push', { signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {} });
    assert.deepEqual(pushed, { ok: true, summary: 'Published target to origin/target' });
  });
  assert.deepEqual(readFileSync(join(decoy, '.git', 'index')), decoyIndex, 'the decoy index is untouched');
  assert.equal(git(decoy, 'log', '--oneline').trim().split('\n').length, 1, 'the decoy gained no commits');
});
