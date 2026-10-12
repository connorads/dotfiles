import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { discard } from './discard.ts';
import { resolveRepo } from './repo.ts';

async function setup() {
  const work = tempDir();
  git(work, 'init', '-q');
  writeFileSync(join(work, 'f.txt'), '1\n'); writeFileSync(join(work, 'gone.txt'), 'x\n');
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'base');
  const trash = join(tempDir(), 'Trash');
  const options = { signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {}, trash };
  return { work, trash, options, repo: (await resolveRepo(work))! };
}

test('discarding unstaged edits keeps staged ones and saves the discarded text as a blob', async () => {
  const { work, repo, options } = await setup();
  writeFileSync(join(work, 'f.txt'), '2\n'); git(work, 'add', 'f.txt');
  writeFileSync(join(work, 'f.txt'), '3 unstaged\n');
  const result = await discard(repo, 'f.txt', 'unstaged', options);
  assert.ok(result.ok);
  assert.equal(readFileSync(join(work, 'f.txt'), 'utf8'), '2\n', 'the staged version remains');
  const blob = /blob ([0-9a-f]{10})/.exec(result.summary)![1]!;
  assert.equal(git(work, 'cat-file', '-p', blob), '3 unstaged\n', 'the discarded text is recoverable');
});

test('a file deleted in the work tree is restored', async () => {
  const { work, repo, options } = await setup();
  rmSync(join(work, 'gone.txt'));
  assert.deepEqual(await discard(repo, 'gone.txt', 'unstaged', options), { ok: true, summary: 'Restored gone.txt' });
  assert.equal(readFileSync(join(work, 'gone.txt'), 'utf8'), 'x\n');
});

test('untracked files and folders move to the Trash without clobbering earlier discards', async () => {
  const { work, repo, options, trash } = await setup();
  writeFileSync(join(work, 'new.txt'), 'first\n');
  assert.deepEqual(await discard(repo, 'new.txt', 'untracked', options), { ok: true, summary: 'Moved new.txt to the Trash' });
  assert.equal(existsSync(join(work, 'new.txt')), false);
  writeFileSync(join(work, 'new.txt'), 'second\n');
  assert.ok((await discard(repo, 'new.txt', 'untracked', options)).ok);
  assert.equal(readFileSync(join(trash, 'new.txt'), 'utf8'), 'first\n', 'the earlier copy survives');
  mkdirSync(join(work, 'scratch')); writeFileSync(join(work, 'scratch', 'a.txt'), 'a\n');
  assert.ok((await discard(repo, 'scratch/', 'untracked', options)).ok);
  assert.equal(readFileSync(join(trash, 'scratch', 'a.txt'), 'utf8'), 'a\n');
});

test('a stale row discards nothing, and paths outside the repository are refused', async () => {
  const { work, repo, options } = await setup();
  const stale = await discard(repo, 'f.txt', 'unstaged', options);
  assert.deepEqual(stale, { ok: false, failure: { reason: 'unknown', message: 'f.txt is no longer changed. Nothing was discarded.' } });
  writeFileSync(join(work, 'f.txt'), 'edited\n');
  const wrongArea = await discard(repo, 'f.txt', 'untracked', options);
  assert.equal(wrongArea.ok, false);
  assert.equal(readFileSync(join(work, 'f.txt'), 'utf8'), 'edited\n', 'a tracked file is never moved as untracked');
  await assert.rejects(discard(repo, '../outside.txt', 'untracked', options), /outside the repository/);
});
