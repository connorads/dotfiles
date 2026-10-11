import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit, tempDir } from './test-git.ts';
import { commitDetail, diff, resolveRepo, snapshot } from './repo.ts';

const git = fixtureGit;
const temp = tempDir;

test('snapshot marks commits missing from every remote and counts ahead', async () => {
  const base = temp();
  const remote = join(base, 'remote.git');
  const work = join(base, 'work');
  git(base, 'init', '-q', '--bare', remote);
  git(base, 'clone', '-q', remote, work);
  writeFileSync(join(work, 'f.txt'), '1\n');
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'pushed'); git(work, 'push', '-q', '-u', 'origin', 'main');
  writeFileSync(join(work, 'f.txt'), '2\n'); git(work, 'commit', '-qam', 'local');
  writeFileSync(join(work, 'new.txt'), 'hello\n');
  const repo = await resolveRepo(join(work));
  assert.equal(repo?.kind, 'repo');
  const result = await snapshot(repo!);
  assert.ok(result.kind === 'repo');
  assert.deepEqual(result.branch, { head: 'main', oid: result.commits[0]!.sha, upstream: 'origin/main', ahead: 1, behind: 0 });
  assert.deepEqual(result.commits.map(c => [c.subject, c.unpushed]), [['local', true], ['pushed', false]]);
  assert.deepEqual(result.changes.map(c => [c.area, c.path]), [['untracked', 'new.txt']]);
  const untracked = await diff(repo!, { path: 'new.txt', origPath: null, source: { kind: 'work-tree', area: 'untracked' } });
  assert.match(untracked.patch, /\+hello/);
  await assert.rejects(diff(repo!, { path: '../remote.git/HEAD', origPath: null, source: { kind: 'work-tree', area: 'untracked' } }), /outside the repository/);
});

test('an unborn branch has no commits', async () => {
  const work = temp();
  git(work, 'init', '-q');
  const result = await snapshot((await resolveRepo(work))!);
  assert.ok(result.kind === 'repo' && result.commits.length === 0 && result.branch.oid === null);
});

test('the home directory falls back to the bare dotfiles repository', async () => {
  const home = temp();
  mkdirSync(join(home, 'git'));
  git(home, 'init', '-q', '--bare', join(home, 'git', 'dotfiles'));
  assert.deepEqual(await resolveRepo(home, home), {
    kind: 'dotfiles', name: 'dotfiles', cwd: home, gitDir: join(home, 'git', 'dotfiles'), commonDir: join(home, 'git', 'dotfiles'),
    select: [`--git-dir=${join(home, 'git', 'dotfiles')}`, `--work-tree=${home}`],
  });
  const elsewhere = temp();
  assert.equal(await resolveRepo(elsewhere, home), null);
});

test('a linked worktree has its own git dir and shares the common dir', async () => {
  const main = temp();
  git(main, 'init', '-q');
  writeFileSync(join(main, 'f.txt'), '1\n'); git(main, 'add', '.'); git(main, 'commit', '-qm', 'init');
  const linked = join(temp(), 'linked');
  git(main, 'worktree', 'add', '-q', '-b', 'side', linked);
  const repo = (await resolveRepo(linked))!;
  assert.equal(repo.cwd, linked);
  assert.equal(repo.commonDir, join(main, '.git'));
  assert.equal(repo.gitDir, join(main, '.git', 'worktrees', 'linked'));
  const result = await snapshot(repo);
  assert.ok(result.kind === 'repo' && result.branch.head === 'side');
});

test('commit detail lists files against the first parent, including a root commit', async () => {
  const work = temp();
  git(work, 'init', '-q');
  writeFileSync(join(work, 'a.txt'), '1\n2\n'); writeFileSync(join(work, 'old.txt'), 'x\ny\nz\n');
  git(work, 'add', '.'); git(work, 'commit', '-qm', 'root');
  git(work, 'mv', 'old.txt', 'new.txt'); writeFileSync(join(work, 'a.txt'), '1\n3\n');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'second', '-m', 'Body line.');
  const repo = (await resolveRepo(work))!;
  const [head, root] = git(work, 'rev-list', 'HEAD').trim().split('\n');
  const detail = await commitDetail(repo, head!);
  assert.equal(detail.subject, 'second');
  assert.equal(detail.body, 'Body line.');
  assert.deepEqual(detail.files.map(f => [f.code, f.path, f.origPath, f.added, f.removed]),
    [['M', 'a.txt', null, 1, 1], ['R', 'new.txt', 'old.txt', 0, 0]]);
  const first = await commitDetail(repo, root!);
  assert.deepEqual(first.parents, []);
  assert.deepEqual(first.files.map(f => [f.code, f.path]), [['A', 'a.txt'], ['A', 'old.txt']]);
  const patch = await diff(repo, { path: 'a.txt', origPath: null, source: { kind: 'commit', sha: head! } });
  assert.match(patch.patch, /-2\n\+3/);
});
