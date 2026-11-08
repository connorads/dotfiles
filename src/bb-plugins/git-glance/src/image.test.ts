import { writeFileSync, renameSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGit as git, tempDir } from './test-git.ts';
import { diff, resolveRepo } from './repo.ts';

const first = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
const second = Buffer.concat([first, Buffer.from('changed')]);
const data = (value: Buffer) => `data:image/png;base64,${value.toString('base64')}`;

test('image previews follow untracked, index, working tree, commits, renames and deletion', async () => {
  const cwd = tempDir();
  git(cwd, 'init', '-q');
  const repo = (await resolveRepo(cwd))!;
  const path = 'picture.png';
  const read = (area: 'untracked' | 'staged' | 'unstaged') => diff(repo, { path, origPath: null, source: { kind: 'work-tree', area } });
  writeFileSync(join(cwd, path), first);
  assert.deepEqual((await read('untracked')).images, { before: null, after: data(first) });
  git(cwd, 'add', path);
  assert.deepEqual((await read('staged')).images, { before: null, after: data(first) });
  git(cwd, 'commit', '-qm', 'Add image');
  const sha = git(cwd, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(cwd, path), second);
  assert.deepEqual((await read('unstaged')).images, { before: data(first), after: data(second) });
  assert.deepEqual((await diff(repo, { path, origPath: null, source: { kind: 'commit', sha } })).images,
    { before: null, after: data(first) });
  git(cwd, 'add', path);
  writeFileSync(join(cwd, path), first);
  assert.deepEqual((await read('staged')).images, { before: data(first), after: data(second) });
  renameSync(join(cwd, path), join(cwd, 'renamed.png'));
  git(cwd, 'add', path, 'renamed.png');
  assert.deepEqual((await diff(repo, { path: 'renamed.png', origPath: path, source: { kind: 'work-tree', area: 'staged' } })).images,
    { before: data(first), after: data(first) });
  unlinkSync(join(cwd, 'renamed.png'));
  assert.deepEqual((await diff(repo, { path: 'renamed.png', origPath: null, source: { kind: 'work-tree', area: 'unstaged' } })).images,
    { before: data(first), after: null });
});

test('image previews bound payloads and reject paths outside the repository', async () => {
  const cwd = tempDir();
  git(cwd, 'init', '-q');
  const repo = (await resolveRepo(cwd))!;
  writeFileSync(join(cwd, 'large.png'), Buffer.alloc(2 * 1024 * 1024 + 1));
  const input = { path: 'large.png', origPath: null, source: { kind: 'work-tree' as const, area: 'untracked' as const } };
  await assert.rejects(diff(repo, input), /2 MiB/);
  git(cwd, 'add', 'large.png');
  await assert.rejects(diff(repo, { ...input, source: { kind: 'work-tree', area: 'staged' } }), /2 MiB/);
  await assert.rejects(diff(repo, { ...input, path: '../outside.png' }), /outside the repository/);
  symlinkSync(join(cwd, 'large.png'), join(cwd, 'link.png'));
  await assert.rejects(diff(repo, { ...input, path: 'link.png' }), /symbolic links/);
  writeFileSync(join(cwd, 'note.constructor'), 'ordinary text');
  assert.equal((await diff(repo, { ...input, path: 'note.constructor' })).images, undefined);
});
