import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { parseStashes } from './porcelain.ts';
import { resolveRepo, snapshot } from './repo.ts';
import { stashAction } from './stashes.ts';
import { gitDirRelevant } from './watch-filter.ts';

const options = () => ({ signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {} });

/** A repo with two stashes: "first" (older, stash@{1}) and "second" (stash@{0}). */
async function setup() {
  const work = tempDir();
  git(work, 'init', '-q');
  writeFileSync(join(work, 'f.txt'), 'base\n'); git(work, 'add', '.'); git(work, 'commit', '-qm', 'base');
  writeFileSync(join(work, 'f.txt'), 'first\n'); git(work, 'stash', 'push', '-q', '-m', 'first');
  writeFileSync(join(work, 'g.txt'), 'second\n'); git(work, 'add', 'g.txt'); git(work, 'stash', 'push', '-q', '-m', 'second');
  const repo = (await resolveRepo(work))!;
  const shas = git(work, 'stash', 'list', '--format=%H').trim().split('\n');
  return { work, repo, second: shas[0]!, first: shas[1]! };
}

test('snapshots list stashes newest first with their current index', async () => {
  const { repo } = await setup();
  const result = await snapshot(repo);
  assert.ok(result.kind === 'repo');
  assert.deepEqual(result.stashes.map(s => [s.index, s.subject]), [[0, 'On main: second'], [1, 'On main: first']]);
});

test('a stash is found by sha even after the indexes shift', async () => {
  const { work, repo, first } = await setup();
  // Another stash lands on top, so "first" moves from stash@{1} to stash@{2}.
  writeFileSync(join(work, 'h.txt'), 'third\n'); git(work, 'add', 'h.txt'); git(work, 'stash', 'push', '-q', '-m', 'third');
  assert.deepEqual(await stashAction(repo, 'drop', first, options()), { ok: true, summary: 'Dropped “first”' });
  assert.deepEqual(git(work, 'stash', 'list', '--format=%gs').trim().split('\n'), ['On main: third', 'On main: second']);
});

test('apply keeps the stash, pop removes it, and a missing stash is reported', async () => {
  const { work, repo, first, second } = await setup();
  assert.deepEqual(await stashAction(repo, 'apply', first, options()), { ok: true, summary: 'Applied “first”' });
  assert.equal(readFileSync(join(work, 'f.txt'), 'utf8'), 'first\n');
  git(work, 'checkout', '-q', '--', 'f.txt');
  assert.deepEqual(await stashAction(repo, 'pop', second, options()), { ok: true, summary: 'Popped “second”' });
  assert.equal(git(work, 'stash', 'list').trim().split('\n').length, 1);
  const missing = await stashAction(repo, 'drop', second, options());
  assert.deepEqual(missing, { ok: false, failure: { reason: 'unknown', message: 'That stash no longer exists.' } });
});

test('applying onto conflicting local edits fails without losing the stash', async () => {
  const { work, repo, first } = await setup();
  writeFileSync(join(work, 'f.txt'), 'local edit\n');
  const result = await stashAction(repo, 'pop', first, options());
  assert.equal(result.ok, false);
  assert.equal(git(work, 'stash', 'list').trim().split('\n').length, 2, 'a failed pop keeps the stash');
});

test('stash list parsing and the stash reflog counts as a change', () => {
  assert.deepEqual(parseStashes('a\x1fOn main: x\x1f10\nb\x1fWIP on main: 1234567 y\x1f5\n'),
    [{ sha: 'a', index: 0, subject: 'On main: x', time: 10 }, { sha: 'b', index: 1, subject: 'WIP on main: 1234567 y', time: 5 }]);
  assert.equal(gitDirRelevant('logs/refs/stash'), true);
  assert.equal(gitDirRelevant('logs/HEAD'), false);
  assert.equal(gitDirRelevant('refs/stash'), true);
});
