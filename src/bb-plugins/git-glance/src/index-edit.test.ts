import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { createCommit, editIndex, review } from './index-edit.ts';
import { resolveRepo, snapshot } from './repo.ts';

const options = () => ({ signal: new AbortController().signal, timeoutMs: 20_000, onProgress: () => {} });
async function setup(born = true) {
  const work = tempDir(); git(work, 'init', '-q');
  git(work, 'config', 'user.name', 'Test'); git(work, 'config', 'user.email', 'test@example.com');
  if (born) { writeFileSync(join(work, 'file'), 'base\n'); git(work, 'add', 'file'); git(work, 'commit', '-qm', 'base'); }
  return { work, repo: (await resolveRepo(work))! };
}

test('partial staging changes only the index in either direction', async () => {
  const { work, repo } = await setup();
  writeFileSync(join(work, 'file'), 'staged\n'); git(work, 'add', 'file');
  writeFileSync(join(work, 'file'), 'working\n');
  assert.ok((await editIndex(repo, { kind: 'unstage', path: 'file' }, options())).ok);
  assert.equal(git(work, 'show', ':file'), 'base\n');
  assert.equal(readFileSync(join(work, 'file'), 'utf8'), 'working\n');
  assert.ok((await editIndex(repo, { kind: 'stage', path: 'file', area: 'unstaged' }, options())).ok);
  assert.equal(git(work, 'show', ':file'), 'working\n');
});

test('unborn index and literal filenames preserve bytes', async () => {
  const { work, repo } = await setup(false);
  for (const path of ['with space', 'with\nnewline', '-option', ':(glob)*', '[abc]']) {
    writeFileSync(join(work, path), Buffer.from([0, 1, 255]));
    assert.ok((await editIndex(repo, { kind: 'stage', path, area: 'untracked' }, options())).ok, path);
    assert.ok((await editIndex(repo, { kind: 'unstage', path }, options())).ok, path);
    assert.deepEqual(readFileSync(join(work, path)), Buffer.from([0, 1, 255]));
  }
  for (const path of ['../outside', '/absolute', 'nul\0path']) await assert.rejects(editIndex(repo, { kind: 'stage', path, area: 'untracked' }, options()));
  mkdirSync(join(work, 'dir')); writeFileSync(join(work, 'dir', 'f'), 'x');
  assert.equal((await editIndex(repo, { kind: 'stage', path: 'dir/', area: 'untracked' }, options())).ok, false);
});

test('rename unstaging restores both index paths without touching working files', async () => {
  const { work, repo } = await setup();
  renameSync(join(work, 'file'), join(work, 'renamed')); git(work, 'add', '-A');
  assert.ok((await editIndex(repo, { kind: 'unstage', path: 'renamed' }, options())).ok);
  assert.equal(git(work, 'show', ':file'), 'base\n');
  assert.equal(readFileSync(join(work, 'renamed'), 'utf8'), 'base\n');
  assert.equal(git(work, 'diff', '--cached'), '');
});

test('deletions, symlinks and ignored paths do not broaden scope', async () => {
  const { work, repo } = await setup();
  rmSync(join(work, 'file'));
  assert.ok((await editIndex(repo, { kind: 'stage', path: 'file', area: 'unstaged' }, options())).ok);
  assert.ok((await editIndex(repo, { kind: 'unstage', path: 'file' }, options())).ok);
  symlinkSync('file', join(work, 'link'));
  assert.ok((await editIndex(repo, { kind: 'stage', path: 'link', area: 'untracked' }, options())).ok);
  assert.ok((await editIndex(repo, { kind: 'unstage', path: 'link' }, options())).ok);
  writeFileSync(join(work, '.gitignore'), 'ignored\n'); writeFileSync(join(work, 'ignored'), 'secret');
  assert.equal((await editIndex(repo, { kind: 'stage', path: 'ignored', area: 'untracked' }, options())).ok, false);
});

test('commit includes the complete reviewed index and excludes working edits', async () => {
  const { work, repo } = await setup();
  writeFileSync(join(work, 'file'), 'index\n'); git(work, 'add', 'file'); writeFileSync(join(work, 'file'), 'working\n');
  const state = await review(repo);
  assert.ok((await createCommit(repo, { kind: 'create-commit', message: 'Subject\n\nBody\n', ...state }, options())).ok);
  assert.equal(git(work, 'show', 'HEAD:file'), 'index\n');
  assert.equal(readFileSync(join(work, 'file'), 'utf8'), 'working\n');
  assert.equal(git(work, 'log', '-1', '--format=%B').trim(), 'Subject\n\nBody');
});

test('empty subject, changed index, locks and failing hooks reject commit', async () => {
  const { work, repo } = await setup(false);
  writeFileSync(join(work, 'file'), 'new'); git(work, 'add', 'file');
  const state = await review(repo);
  assert.equal((await createCommit(repo, { kind: 'create-commit', message: ' \nbody', ...state }, options())).ok, false);
  writeFileSync(join(work, 'file'), 'changed'); git(work, 'add', 'file');
  assert.equal((await createCommit(repo, { kind: 'create-commit', message: 'Subject', ...state }, options())).ok, false);
  const current = await review(repo);
  writeFileSync(join(repo.gitDir, 'index.lock'), '');
  assert.equal((await createCommit(repo, { kind: 'create-commit', message: 'Subject', ...current }, options())).ok, false);
  rmSync(join(repo.gitDir, 'index.lock'));
  const hook = join(repo.gitDir, 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho hook-refused >&2\nexit 1\n'); chmodSync(hook, 0o755);
  const failed = await createCommit(repo, { kind: 'create-commit', message: 'Subject', ...current }, options());
  assert.equal(failed.ok, false); if (!failed.ok) assert.match(failed.failure.message, /hook-refused/);
  rmSync(hook);
  assert.ok((await createCommit(repo, { kind: 'create-commit', message: 'Root', ...current }, options())).ok);
});

test('commit review counts beyond the display cap', async () => {
  const { work, repo } = await setup(false);
  for (let i = 0; i < 405; i++) writeFileSync(join(work, `f${i}`), 'x');
  git(work, 'add', '.');
  const displayed = await snapshot(repo);
  assert.equal(displayed.kind === 'none' ? 0 : displayed.changes.length, 400);
  assert.equal((await review(repo)).count, 405);
});

test('dotfiles reads omit clean-only churn and genuine filtered edits stage normally', async () => {
  const home = tempDir(); mkdirSync(join(home, 'git'));
  const dir = join(home, 'git', 'dotfiles'); git(home, 'init', '--bare', '-q', dir);
  const select = [`--git-dir=${dir}`, `--work-tree=${home}`];
  git(home, ...select, 'config', 'filter.local.clean', "sed '/^local=/d'");
  writeFileSync(join(home, '.gitattributes'), 'settings filter=local\n');
  writeFileSync(join(home, 'settings'), 'shared=one\nlocal=one\n');
  git(home, ...select, 'add', '.gitattributes', 'settings'); git(home, ...select, 'commit', '-qm', 'base');
  const repo = (await resolveRepo(home, home))!;
  writeFileSync(join(home, 'settings'), 'shared=one\nlocal=longer\n');
  const before = readFileSync(join(dir, 'index'));
  const state = await snapshot(repo);
  assert.ok(state.kind !== 'none');
  assert.equal(state.changes.some(c => c.path === 'settings'), false);
  assert.deepEqual(readFileSync(join(dir, 'index')), before);
  writeFileSync(join(home, 'settings'), 'shared=two\nlocal=longer\n');
  assert.ok((await editIndex(repo, { kind: 'stage', path: 'settings', area: 'unstaged' }, options())).ok);
  assert.equal(git(home, ...select, 'show', ':settings'), 'shared=two\n');
});

test('changed HEAD, signing failure, timeout and cancellation never retry a commit', async () => {
  const { work, repo } = await setup();
  writeFileSync(join(work, 'file'), 'next'); git(work, 'add', 'file');
  const old = await review(repo); git(work, 'commit', '-qm', 'external');
  writeFileSync(join(work, 'file'), 'next again'); git(work, 'add', 'file');
  assert.equal((await createCommit(repo, { kind: 'create-commit', message: 'Stale', ...old }, options())).ok, false);
  const current = await review(repo);
  git(work, 'config', 'commit.gpgsign', 'true'); git(work, 'config', 'gpg.program', '/usr/bin/false');
  assert.equal((await createCommit(repo, { kind: 'create-commit', message: 'Sign', ...current }, options())).ok, false);
  git(work, 'config', 'commit.gpgsign', 'false');
  const hook = join(repo.gitDir, 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nsleep 10\n'); chmodSync(hook, 0o755);
  const timed = await createCommit(repo, { kind: 'create-commit', message: 'Timeout', ...current }, { ...options(), timeoutMs: 100 });
  assert.equal(timed.ok, false); if (!timed.ok) assert.equal(timed.failure.reason, 'timeout');
  const controller = new AbortController(); controller.abort();
  const cancelled = await createCommit(repo, { kind: 'create-commit', message: 'Cancel', ...current }, { ...options(), signal: controller.signal });
  assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(cancelled.failure.reason, 'cancelled');
  assert.equal(git(work, 'rev-parse', 'HEAD').trim(), current.head);
});

test('host serialises root aliases against the same index', async () => {
  const { experimental_createHostEntryHarness } = await import('@get-bb/plugin-sdk/testing/host');
  const { default: entry } = await import('../host.ts');
  const { work, repo } = await setup();
  mkdirSync(join(work, 'nested'));
  writeFileSync(join(work, 'file'), 'next'); git(work, 'add', 'file');
  const hook = join(repo.gitDir, 'hooks', 'pre-commit');
  const marker = join(repo.gitDir, 'hook-started');
  writeFileSync(hook, '#!/bin/sh\ntouch .git/hook-started\nsleep 1\nexit 1\n'); chmodSync(hook, 0o755);
  const harness = experimental_createHostEntryHarness(entry);
  try {
    const current = await review(repo);
    const first = harness.experimental_call('run', { root: work, request: { kind: 'create-commit', message: 'one', ...current }, opId: 'one' });
    const { existsSync } = await import('node:fs');
    for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(marker));
    const second = await harness.experimental_call('run', { root: join(work, 'nested'), request: { kind: 'unstage', path: 'file' }, opId: 'two' });
    assert.equal(second.ok, false); if (!second.ok) assert.equal(second.failure.reason, 'locked');
    await first;
    assert.notEqual(git(work, 'diff', '--cached'), '');
  } finally { await harness.experimental_dispose(); }
});

test('conflicts and submodules cannot be staged through file actions', async () => {
  const { work, repo } = await setup();
  git(work, 'checkout', '-qb', 'side'); writeFileSync(join(work, 'file'), 'side\n'); git(work, 'commit', '-qam', 'side');
  git(work, 'checkout', 'main'); writeFileSync(join(work, 'file'), 'main\n'); git(work, 'commit', '-qam', 'main');
  try { git(work, 'merge', 'side'); } catch { /* expected conflict */ }
  assert.equal((await editIndex(repo, { kind: 'stage', path: 'file', area: 'unstaged' }, options())).ok, false);
  assert.match((await review(repo)).blocked ?? '', /operation|conflicts/);
  git(work, 'merge', '--abort');
  const source = await setup();
  git(work, '-c', 'protocol.file.allow=always', 'submodule', 'add', source.work, 'child'); git(work, 'commit', '-qam', 'submodule');
  writeFileSync(join(work, 'child', 'file'), 'dirty child\n');
  const result = await editIndex(repo, { kind: 'stage', path: 'child', area: 'unstaged' }, options());
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.failure.message, /submodules/);
});


test('tracked file replaced by a directory cannot stage unreviewed descendants', async () => {
  const { work, repo } = await setup();
  rmSync(join(work, 'file'));
  mkdirSync(join(work, 'file'));
  writeFileSync(join(work, 'file', 'unreviewed'), 'private');
  const result = await editIndex(repo, { kind: 'stage', path: 'file', area: 'unstaged' }, options());
  assert.equal(git(work, 'ls-files', '--', 'file/unreviewed'), '');
  assert.equal(git(work, 'diff', '--cached'), '');
  assert.equal(result.ok, false);
});
