import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { resolveRepo } from './repo.ts';
import { publishRemote, sync } from './sync.ts';

const git = fixtureGit;

/** A bare remote with two clones, `mine` and `theirs`, both tracking main. */
function setup() {
  const base = tempDir();
  const remote = join(base, 'remote.git');
  git(base, 'init', '-q', '--bare', remote);
  const mine = join(base, 'mine'), theirs = join(base, 'theirs');
  git(base, 'clone', '-q', remote, mine);
  writeFileSync(join(mine, 'f.txt'), 'base\n');
  git(mine, 'add', '.'); git(mine, 'commit', '-qm', 'base'); git(mine, 'push', '-q', '-u', 'origin', 'main');
  git(base, 'clone', '-q', remote, theirs);
  const commit = (dir: string, file: string, text: string) => {
    writeFileSync(join(dir, file), text); git(dir, 'add', '.'); git(dir, 'commit', '-qm', `${file}: ${text.trim()}`);
  };
  return { mine, theirs, commit };
}
const options = () => ({ signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {} });
const repoAt = async (dir: string) => (await resolveRepo(dir))!;

test('push sends local commits, then reports up to date', async () => {
  const { mine, commit } = setup();
  commit(mine, 'a.txt', '1\n'); commit(mine, 'b.txt', '2\n');
  assert.deepEqual(await sync(await repoAt(mine), 'push', options()), { ok: true, summary: 'Pushed 2 commits to origin/main' });
  assert.deepEqual(await sync(await repoAt(mine), 'push', options()), { ok: true, summary: 'origin/main is already up to date' });
});

test('push publishes a branch with no upstream', async () => {
  const { mine, commit } = setup();
  git(mine, 'switch', '-qc', 'feature'); commit(mine, 'c.txt', '3\n');
  assert.deepEqual(await sync(await repoAt(mine), 'push', options()), { ok: true, summary: 'Published feature to origin/feature' });
  assert.equal(git(mine, 'rev-parse', '--abbrev-ref', '@{upstream}').trim(), 'origin/feature');
});

test('a push behind the remote is rejected; fetch then pull fast-forwards', async () => {
  const { mine, theirs, commit } = setup();
  commit(theirs, 't.txt', 'theirs\n'); git(theirs, 'push', '-q');
  commit(mine, 'm.txt', 'mine\n');
  const rejected = await sync(await repoAt(mine), 'push', options());
  assert.equal(rejected.ok, false);
  assert.equal(!rejected.ok && rejected.failure.reason, 'rejected');
  git(mine, 'reset', '-q', '--hard', 'HEAD~1');
  assert.deepEqual(await sync(await repoAt(mine), 'fetch', options()), { ok: true, summary: '1 new commit on origin/main' });
  assert.deepEqual(await sync(await repoAt(mine), 'pull', options()), { ok: true, summary: 'Pulled 1 commit from origin/main' });
  assert.deepEqual(await sync(await repoAt(mine), 'pull', options()), { ok: true, summary: 'Already up to date with origin/main' });
});

test('pull refuses diverged branches and edits it would overwrite', async () => {
  const { mine, theirs, commit } = setup();
  commit(theirs, 'f.txt', 'theirs\n'); git(theirs, 'push', '-q');
  writeFileSync(join(mine, 'f.txt'), 'uncommitted\n');
  const dirty = await sync(await repoAt(mine), 'pull', options());
  assert.equal(!dirty.ok && dirty.failure.reason, 'dirty');
  git(mine, 'checkout', '-q', '--', 'f.txt');
  commit(mine, 'm.txt', 'mine\n');
  const diverged = await sync(await repoAt(mine), 'pull', options());
  assert.equal(!diverged.ok && diverged.failure.reason, 'diverged');
});

test('cancelling stops git and reports cancelled', async () => {
  const { mine } = setup();
  git(mine, 'remote', 'set-url', 'origin', 'https://127.0.0.1:9/never.git');
  const controller = new AbortController();
  controller.abort();
  const result = await sync(await repoAt(mine), 'fetch', { ...options(), signal: controller.signal });
  assert.deepEqual(!result.ok && result.failure.reason, 'cancelled');
});

test('an unreachable remote fails as a network problem, without prompting', async () => {
  const { mine } = setup();
  git(mine, 'remote', 'set-url', 'origin', 'https://127.0.0.1:9/never.git');
  const result = await sync(await repoAt(mine), 'fetch', options());
  assert.equal(!result.ok && result.failure.reason, 'network');
});

test('publish prefers origin, else the only remote', () => {
  assert.equal(publishRemote(['upstream', 'origin']), 'origin');
  assert.equal(publishRemote(['fork']), 'fork');
  assert.equal(publishRemote(['a', 'b']), null);
});
