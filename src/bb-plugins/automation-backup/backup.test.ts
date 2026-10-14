import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { backup, makeSnapshot, serialise } from './backup.ts';

const task = {
  id: 'auto_one', projectId: 'proj_one', name: 'Inbox', enabled: true,
  trigger: { triggerType: 'schedule', cron: '0 9 * * *', timezone: 'Europe/London' },
  execution: { mode: 'agent', prompt: 'Private prompt\n', providerId: 'codex', model: 'model' },
};
const snapshot = () => makeSnapshot([{ id: 'proj_one', name: 'KB', automations: [task] }]);
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) }).trim();
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'automation-backup-test-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  await mkdir(repo);
  git(root, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Backup test');
  git(repo, 'config', 'user.email', 'test@users.noreply.github.com');
  await writeFile(join(repo, 'README.md'), 'Private backup\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'Initialise');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  return { root, repo, remote };
}
const source = () => ({ read: async () => snapshot(), verifyRemote: async () => {} });

test('snapshot retains configuration and ignores runtime churn', () => {
  const changed = { ...task, runCount: 50, nextRunAt: 999, updatedAt: 1000, lastRunStatus: 'failed' };
  assert.equal(serialise(snapshot()), serialise(makeSnapshot([{ id: 'proj_one', name: 'KB', automations: [changed] }])));
  assert.match(serialise(snapshot()), /Private prompt/);
});

test('a damaged record stops the complete export', () => {
  assert.throws(() => makeSnapshot([{ id: 'proj_one', name: 'KB', automations: [{ ...task, problem: 'missing-agent-prompt' }] }]));
  assert.throws(() => makeSnapshot([{ id: 'proj_one', name: 'KB', automations: [{ ...task, projectId: 'another' }] }]));
});

test('changed configuration commits and pushes; unchanged configuration creates no commit', async () => {
  const { repo } = await repository();
  const first = await backup(repo, source());
  assert.equal(first.changed, true);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'origin/main'));
  const head = git(repo, 'rev-parse', 'HEAD');
  const second = await backup(repo, source());
  assert.equal(second.changed, false);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(repo, 'automations.json'), 'utf8'), serialise(snapshot()));
});

test('failed source read and failed privacy check preserve the previous snapshot', async () => {
  const { repo } = await repository();
  await backup(repo, source());
  const before = await readFile(join(repo, 'automations.json'), 'utf8');
  await assert.rejects(backup(repo, { ...source(), read: async () => { throw new Error('offline'); } }));
  await assert.rejects(backup(repo, { ...source(), verifyRemote: async () => { throw new Error('public'); } }));
  assert.equal(await readFile(join(repo, 'automations.json'), 'utf8'), before);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('failed push retains a commit and the next run pushes it without a new commit', async () => {
  const { repo, remote } = await repository();
  await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(backup(repo, source()));
  const head = git(repo, 'rev-parse', 'HEAD');
  assert.notEqual(head, git(repo, 'rev-parse', 'origin/main'));
  await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal((await backup(repo, source())).changed, false);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo, 'rev-parse', 'origin/main'), head);
});

test('another writer lock and dirty unrelated files prevent backup', async () => {
  const { repo } = await repository();
  const lock = join(repo, '.git', 'automation-backup.lock');
  await mkdir(lock);
  await assert.rejects(backup(repo, source()), /writer/);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  const { repo: dirty } = await repository();
  await writeFile(join(dirty, 'unrelated.txt'), 'Human edits');
  await assert.rejects(backup(dirty, source()), /clean/);
  assert.equal(await readFile(join(dirty, 'unrelated.txt'), 'utf8'), 'Human edits');
});


test('script and one-shot definitions retain their content', () => {
  const script = { ...task, trigger: { triggerType: 'once', at: 1234 }, execution: { mode: 'script', interpreter: 'bash', script: 'echo hello\n', env: { MODE: 'daily' } } };
  const content = serialise(makeSnapshot([{ id: 'proj_one', name: 'KB', automations: [script] }]));
  assert.match(content, /echo hello/);
  assert.match(content, /daily/);
  assert.match(content, /1234/);
});

test('multiple push destinations are refused before writing', async () => {
  const { repo, remote } = await repository();
  git(repo, 'config', '--add', 'remote.origin.pushurl', remote);
  git(repo, 'config', '--add', 'remote.origin.pushurl', remote + '-other');
  await assert.rejects(backup(repo, source()), /exactly one push destination/);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});


test('inherited Git directory variables cannot redirect the backup', async () => {
  const { repo } = await repository();
  const { repo: other } = await repository();
  const previousDir = process.env.GIT_DIR;
  const previousTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = join(other, '.git');
  process.env.GIT_WORK_TREE = other;
  const untouched = git(other, 'rev-parse', 'HEAD');
  try {
    await backup(repo, source());
    assert.equal(git(other, 'rev-parse', 'HEAD'), untouched);
    assert.equal(git(other, 'status', '--porcelain'), '');
    assert.match(await readFile(join(repo, 'automations.json'), 'utf8'), /Private prompt/);
  } finally {
    if (previousDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previousDir;
    if (previousTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = previousTree;
  }
});
