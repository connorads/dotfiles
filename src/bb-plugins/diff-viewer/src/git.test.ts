// Host-side git against real throwaway repositories, through the host entry
// harness where the contract boundary matters.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { experimental_createHostEntryHarness } from '@get-bb/plugin-sdk/testing/host';
import type { FileDiff, LoadResult, View } from '../contracts.ts';
import entry from '../host.ts';
import { load, loadFile } from './git.ts';
import { fixtureGit as git, tempDir } from './test-git.ts';

const commitAll = (cwd: string, message: string, ...select: string[]) => {
  git(cwd, ...select, 'add', '-A');
  git(cwd, ...select, 'commit', '-qm', message);
};
function okView(result: LoadResult): Extract<View, { ok: true }> {
  assert.ok(result.kind !== 'none', 'expected a repository');
  assert.ok(result.view.ok, result.view.ok ? '' : result.view.message);
  return result.view;
}
const summary = (files: FileDiff[]) => files.map(f => [f.path, f.status, f.body.kind, f.additions, f.deletions]);

/** A clone with one pushed commit on main, then two unpushed ones. */
function clonedRepo() {
  const base = tempDir();
  git(base, 'init', '-q', '--bare', 'remote.git');
  const work = join(base, 'work');
  git(base, 'clone', '-q', 'remote.git', work);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  writeFileSync(join(work, 'keep.md'), 'keep\n');
  commitAll(work, 'pushed');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');
  writeFileSync(join(work, 'a.txt'), 'two\n');
  commitAll(work, 'first unpushed');
  writeFileSync(join(work, 'b.txt'), 'bee\n');
  commitAll(work, 'second unpushed');
  return work;
}

test('uncommitted: staged, unstaged, untracked, deleted, renamed and binary, through the host contract', async () => {
  const work = clonedRepo();
  writeFileSync(join(work, 'a.txt'), 'three\n');
  writeFileSync(join(work, 'staged.ts'), 'export {};\n');
  git(work, 'add', 'staged.ts');
  writeFileSync(join(work, 'new file.md'), 'hello\nworld\n');
  writeFileSync(join(work, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
  git(work, 'mv', 'keep.md', 'docs.md');
  rmSync(join(work, 'b.txt'));
  mkdirSync(join(work, 'nested'));
  git(join(work, 'nested'), 'init', '-q');
  writeFileSync(join(work, 'nested', 'inner.txt'), 'x\n');

  const host = experimental_createHostEntryHarness(entry);
  const result = await host.experimental_call('load', { root: work, scope: { kind: 'uncommitted' } });
  await host.experimental_dispose();
  assert.ok(result.kind === 'repo');
  assert.equal(result.branch, 'main');
  const view = okView(result);
  assert.equal(view.label, 'HEAD');
  assert.equal(view.spec.to, null);
  assert.deepEqual(summary(view.files), [
    ['a.txt', 'modified', 'patch', 1, 1],
    ['b.txt', 'deleted', 'patch', 0, 1],
    ['blob.bin', 'added', 'binary', null, null],
    ['docs.md', 'renamed', 'empty', 0, 0],
    ['new file.md', 'added', 'patch', 2, 0],
    ['staged.ts', 'added', 'patch', 1, 0],
  ]);
  assert.equal(view.files.find(f => f.path === 'docs.md')!.oldPath, 'keep.md');
  const untracked = view.files.find(f => f.path === 'new file.md')!;
  assert.ok(untracked.untracked && untracked.body.kind === 'patch');
  assert.match(untracked.body.patch, /^\+world$/m);
});

test('a plain directory is not a repository', async () => {
  assert.deepEqual(await load(tempDir(), '/nowhere', { kind: 'uncommitted' }), { kind: 'none' });
});

test('the home checkout falls back to the bare dotfiles repository, tracked files only', async () => {
  const home = tempDir();
  const gitDir = join(home, 'git', 'dotfiles');
  mkdirSync(join(home, 'git'));
  git(home, 'init', '-q', '--bare', gitDir);
  const select = [`--git-dir=${gitDir}`, `--work-tree=${home}`];
  writeFileSync(join(home, '.zshrc'), 'a\n');
  git(home, ...select, 'add', '.zshrc');
  git(home, ...select, 'commit', '-qm', 'dotfiles');
  writeFileSync(join(home, '.zshrc'), 'b\n');
  writeFileSync(join(home, 'stray.txt'), 'never listed\n');

  const result = await load(`${home}/`, home, { kind: 'uncommitted' });
  assert.equal(result.kind, 'dotfiles');
  const view = okView(result);
  assert.deepEqual(summary(view.files), [['.zshrc', 'modified', 'patch', 1, 1]]);
  assert.equal(view.spec.untracked, false);
  assert.match(view.note ?? '', /Tracked files only/);
  // A subdirectory of home is not the dotfiles root.
  mkdirSync(join(home, 'sub'));
  assert.deepEqual(await load(join(home, 'sub'), home, { kind: 'uncommitted' }), { kind: 'none' });
});

test('unpushed: cumulative diff since the upstream, with a commit list to narrow it', async () => {
  const work = clonedRepo();
  writeFileSync(join(work, 'dirty.txt'), 'not committed\n');
  const all = okView(await load(work, '/nowhere', { kind: 'unpushed', commit: null }));
  assert.equal(all.label, 'origin/main..HEAD');
  assert.deepEqual(all.commits!.map(c => c.subject), ['second unpushed', 'first unpushed']);
  assert.deepEqual(summary(all.files), [['a.txt', 'modified', 'patch', 1, 1], ['b.txt', 'added', 'patch', 1, 0]]);

  const first = all.commits![1]!;
  const one = okView(await load(work, '/nowhere', { kind: 'unpushed', commit: first.sha }));
  assert.equal(one.label, `${first.shortSha} first unpushed`);
  assert.deepEqual(summary(one.files), [['a.txt', 'modified', 'patch', 1, 1]]);

  const gone = await load(work, '/nowhere', { kind: 'unpushed', commit: 'f'.repeat(40) });
  assert.ok(gone.kind === 'repo' && !gone.view.ok && /no longer unpushed/.test(gone.view.message));
});

test('unpushed falls back to origin/HEAD, and says so when neither exists', async () => {
  const work = clonedRepo();
  git(work, 'switch', '-qc', 'local-only');
  writeFileSync(join(work, 'c.txt'), 'see\n');
  commitAll(work, 'third');
  const view = okView(await load(work, '/nowhere', { kind: 'unpushed', commit: null }));
  assert.equal(view.label, 'origin/HEAD..HEAD');
  assert.equal(view.commits!.length, 3);

  const lonely = tempDir();
  git(lonely, 'init', '-q');
  writeFileSync(join(lonely, 'x'), 'x\n');
  commitAll(lonely, 'only');
  const result = await load(lonely, '/nowhere', { kind: 'unpushed', commit: null });
  assert.ok(result.kind === 'repo' && !result.view.ok);
  assert.match(result.view.message, /No upstream and no origin\/HEAD/);
});

test('branch: merge base with the default branch to the work tree, with a note when it equals Unpushed', async () => {
  const work = clonedRepo();
  writeFileSync(join(work, 'dirty.txt'), 'wip\n');
  const onMain = okView(await load(work, '/nowhere', { kind: 'branch' }));
  assert.equal(onMain.label, 'origin/main...HEAD + uncommitted');
  assert.match(onMain.note ?? '', /Branch equals Unpushed plus uncommitted/);
  assert.deepEqual(onMain.files.map(f => f.path), ['a.txt', 'b.txt', 'dirty.txt']);

  git(work, 'switch', '-qc', 'feature');
  git(work, 'push', '-q', '-u', 'origin', 'feature');
  writeFileSync(join(work, 'feature.txt'), 'f\n');
  commitAll(work, 'feature work');
  const feature = okView(await load(work, '/nowhere', { kind: 'branch' }));
  assert.equal(feature.note, null);
  assert.deepEqual(feature.files.map(f => f.path), ['a.txt', 'b.txt', 'dirty.txt', 'feature.txt']);
});

test('lockfiles and huge files wait, then load whole on request', async () => {
  const work = clonedRepo();
  writeFileSync(join(work, 'pnpm-lock.yaml'), 'lock: 1\n');
  writeFileSync(join(work, 'big.txt'), Array.from({ length: 1_500 }, (_, i) => `line ${i}`).join('\n') + '\n');
  git(work, 'add', 'pnpm-lock.yaml', 'big.txt');
  const view = okView(await load(work, '/nowhere', { kind: 'uncommitted' }));
  const lock = view.files.find(f => f.path === 'pnpm-lock.yaml')!;
  assert.deepEqual([lock.lockfile, lock.body], [true, { kind: 'deferred', reason: 'lockfile' }]);
  assert.equal(view.files.at(-1)!.path, 'pnpm-lock.yaml');
  const big = view.files.find(f => f.path === 'big.txt')!;
  assert.ok(big.body.kind === 'patch');
  assert.deepEqual([big.body.shownLines, big.body.totalLines], [1_000, 1_500]);

  const whole = await loadFile(work, '/nowhere', { spec: view.spec, path: 'big.txt', oldPath: null, untracked: false });
  assert.ok(whole.kind === 'patch');
  assert.deepEqual([whole.shownLines, whole.totalLines], [1_500, 1_500]);
  const locked = await loadFile(work, '/nowhere', { spec: view.spec, path: 'pnpm-lock.yaml', oldPath: null, untracked: false });
  assert.ok(locked.kind === 'patch' && /\+lock: 1/.test(locked.patch));
  await assert.rejects(loadFile(work, '/nowhere', { spec: view.spec, path: '../etc/passwd', oldPath: null, untracked: true }), /outside the repository/);
});

test('a whole-file read of an untracked path accepts only files the listing shows', async () => {
  const work = clonedRepo();
  writeFileSync(join(work, '.gitignore'), '.env\n');
  writeFileSync(join(work, '.env'), 'SECRET=1\n');
  writeFileSync(join(work, 'fresh.txt'), 'new\n');
  const view = okView(await load(work, '/nowhere', { kind: 'uncommitted' }));
  const read = (path: string, spec = view.spec) => loadFile(work, '/nowhere', { spec, path, oldPath: null, untracked: true });
  const fresh = await read('fresh.txt');
  assert.ok(fresh.kind === 'patch' && /^\+new$/m.test(fresh.patch));
  await assert.rejects(read('.env'), /Not an untracked file/);
  await assert.rejects(read('a.txt'), /Not an untracked file/);
  await assert.rejects(read('fresh.txt', { ...view.spec, untracked: false }), /Not an untracked file/);
});

test('a stat-only change neither lists the file nor rewrites the index', async () => {
  const work = clonedRepo();
  const index = join(work, '.git', 'index');
  // Stat data that no longer matches the index, with the same content: what an editor's save or `touch` leaves.
  utimesSync(join(work, 'a.txt'), new Date(2001, 0, 1), new Date(2001, 0, 1));
  writeFileSync(join(work, 'b.txt'), 'edited\n');
  const before = statSync(index), bytes = readFileSync(index);
  const view = okView(await load(work, '/nowhere', { kind: 'uncommitted' }));
  assert.deepEqual(view.files.map(f => f.path), ['b.txt']);
  const after = statSync(index);
  assert.deepEqual([after.ino, after.mtimeMs], [before.ino, before.mtimeMs]);
  assert.deepEqual(readFileSync(index), bytes);
});

test('a submodule bump reads as its own file, whatever diff.submodule says', async () => {
  const work = clonedRepo();
  const sub = tempDir();
  git(sub, 'init', '-q');
  writeFileSync(join(sub, 's.txt'), 's\n');
  commitAll(sub, 'sub');
  git(work, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub');
  commitAll(work, 'add sub');
  git(join(work, 'sub'), 'commit', '-q', '--allow-empty', '-m', 'bump');
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  git(work, 'config', 'diff.submodule', 'log');
  const view = okView(await load(work, '/nowhere', { kind: 'uncommitted' }));
  const [a, bumped] = [view.files.find(f => f.path === 'a.txt')!, view.files.find(f => f.path === 'sub')!];
  assert.ok(a.body.kind === 'patch' && !/Submodule/.test(a.body.patch));
  assert.ok(bumped.body.kind === 'patch' && /^\+Subproject commit /m.test(bumped.body.patch));
});

test('a dangling origin/HEAD falls through to origin/main', async () => {
  const work = clonedRepo();
  git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone');
  const view = okView(await load(work, '/nowhere', { kind: 'branch' }));
  assert.equal(view.label, 'origin/main...HEAD + uncommitted');
});

test('hook variables never redirect git to another repository', async () => {
  const decoy = tempDir();
  git(decoy, 'init', '-q');
  writeFileSync(join(decoy, 'd.txt'), 'decoy\n');
  commitAll(decoy, 'decoy');
  const decoyIndex = readFileSync(join(decoy, '.git', 'index'));
  const work = clonedRepo();
  writeFileSync(join(work, 'a.txt'), 'changed\n');

  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  Object.assign(process.env, { GIT_DIR: join(decoy, '.git'), GIT_INDEX_FILE: join(decoy, '.git', 'index'), GIT_WORK_TREE: decoy });
  try {
    const view = okView(await load(work, '/nowhere', { kind: 'uncommitted' }));
    assert.deepEqual(view.files.map(f => f.path), ['a.txt']);
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  assert.deepEqual(readFileSync(join(decoy, '.git', 'index')), decoyIndex, 'the decoy index is untouched');
});
