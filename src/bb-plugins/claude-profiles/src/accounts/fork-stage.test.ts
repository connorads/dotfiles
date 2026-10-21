import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readlink, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageFork, sweepForkStages, unstageFork } from './fork-stage.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fork-stage-'));
  const defaultDir = join(root, 'default');
  const accountDir = join(root, 'account');
  const project = join(accountDir, 'projects', '-work-repo');
  await mkdir(join(defaultDir, 'projects'), { recursive: true });
  await mkdir(project, { recursive: true });
  const sessionId = randomUUID();
  await writeFile(join(project, `${sessionId}.jsonl`), '{}\n');
  return { root, defaultDir, accountDir, project, sessionId };
}

test('staging links the account project holding the source session into the default projects', async () => {
  const f = await fixture();
  const staged = await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  const link = join(f.defaultDir, 'projects', '+bb-fork-stage-thr_fork1');
  assert.deepEqual(staged, { link, target: f.project });
  assert.equal(await readlink(link), f.project);
});

test('staging twice for the same fork keeps the one link', async () => {
  const f = await fixture();
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  assert.deepEqual(await readdir(join(f.defaultDir, 'projects')), ['+bb-fork-stage-thr_fork1']);
});

test('staging creates the default projects directory when it is missing', async () => {
  const f = await fixture();
  const fresh = join(f.root, 'fresh-default');
  await stageFork(fresh, f.accountDir, f.sessionId, 'thr_fork1');
  assert.ok((await lstat(join(fresh, 'projects', '+bb-fork-stage-thr_fork1'))).isSymbolicLink());
});

test('staging refuses a session the account does not hold exactly once', async () => {
  const f = await fixture();
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, randomUUID(), 'thr_fork1'), /not found in this account/);
  await mkdir(join(f.accountDir, 'projects', '-other'));
  await writeFile(join(f.accountDir, 'projects', '-other', `${f.sessionId}.jsonl`), '{}\n');
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1'), /2 project directories/);
  assert.deepEqual(await readdir(join(f.defaultDir, 'projects')), []);
});

test('staging ignores a symlinked transcript and a symlinked project directory', async () => {
  const f = await fixture();
  const linked = join(f.accountDir, 'projects', '-linked');
  await symlink(f.project, linked, 'dir');
  const other = randomUUID();
  await mkdir(join(f.accountDir, 'projects', '-file-link'));
  await symlink(join(f.project, `${f.sessionId}.jsonl`), join(f.accountDir, 'projects', '-file-link', `${other}.jsonl`));
  assert.equal((await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1'))?.target, f.project);
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, other, 'thr_fork2'), /not found in this account/);
});

test('staging refuses malformed session and thread IDs', async () => {
  const f = await fixture();
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, '../x', 'thr_fork1'), /Invalid native session ID/);
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, f.sessionId, '../fork'), /Invalid thread ID/);
});

test('staging refuses to replace an existing entry with another target', async () => {
  const f = await fixture();
  await symlink(f.root, join(f.defaultDir, 'projects', '+bb-fork-stage-thr_fork1'), 'dir');
  await assert.rejects(stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1'), /already exists/);
});

test('unstaging reports whether the fork landed beside the source, then removes only the link', async () => {
  const f = await fixture();
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  const forkId = randomUUID();
  await writeFile(join(f.project, `${forkId}.jsonl`), '{}\n');
  assert.deepEqual(await unstageFork(f.defaultDir, 'thr_fork1', forkId), { removed: true, forked: true });
  assert.deepEqual(await readdir(join(f.defaultDir, 'projects')), []);
  assert.deepEqual((await readdir(f.project)).sort(), [`${forkId}.jsonl`, `${f.sessionId}.jsonl`].sort());
});

test('unstaging flags a fork that did not land in the account', async () => {
  const f = await fixture();
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  assert.deepEqual(await unstageFork(f.defaultDir, 'thr_fork1', randomUUID()), { removed: true, forked: false });
});

test('unstaging a failed fork removes the link without a check', async () => {
  const f = await fixture();
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_fork1');
  assert.deepEqual(await unstageFork(f.defaultDir, 'thr_fork1', null), { removed: true, forked: null });
  assert.deepEqual(await unstageFork(f.defaultDir, 'thr_fork1', null), { removed: false, forked: null });
});

test('unstaging leaves a real directory with the stage name alone', async () => {
  const f = await fixture();
  await mkdir(join(f.defaultDir, 'projects', '+bb-fork-stage-thr_fork1'));
  assert.deepEqual(await unstageFork(f.defaultDir, 'thr_fork1', null), { removed: false, forked: null });
  assert.ok((await lstat(join(f.defaultDir, 'projects', '+bb-fork-stage-thr_fork1'))).isDirectory());
});

test('the sweep removes only stage links older than the limit', async () => {
  const f = await fixture();
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_old');
  await stageFork(f.defaultDir, f.accountDir, f.sessionId, 'thr_new');
  await mkdir(join(f.defaultDir, 'projects', '-real-project'));
  const old = new Date(Date.now() - 60 * 60_000);
  const { lutimes } = await import('node:fs/promises');
  await lutimes(join(f.defaultDir, 'projects', '+bb-fork-stage-thr_old'), old, old);
  await utimes(join(f.defaultDir, 'projects', '-real-project'), old, old);
  assert.deepEqual(await sweepForkStages(f.defaultDir, 10 * 60_000), ['+bb-fork-stage-thr_old']);
  assert.deepEqual((await readdir(join(f.defaultDir, 'projects'))).sort(), ['+bb-fork-stage-thr_new', '-real-project']);
  assert.deepEqual(await readdir(f.project), [`${f.sessionId}.jsonl`]);
});

test('the sweep tolerates a missing default projects directory', async () => {
  const f = await fixture();
  assert.deepEqual(await sweepForkStages(join(f.root, 'absent'), 0), []);
});
