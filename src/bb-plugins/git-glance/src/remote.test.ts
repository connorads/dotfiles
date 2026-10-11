import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, parseProgress, parsePushPorcelain } from './remote.ts';

test('progress takes the latest in-place update, including remote lines', () => {
  assert.deepEqual(parseProgress('Counting objects:  10% (1/10)\rCounting objects:  60% (6/10)\r'), { phase: 'Counting objects', percent: 60 });
  assert.deepEqual(parseProgress('remote: Resolving deltas: 100% (3/3), done.\n'), { phase: 'Resolving deltas', percent: 100 });
  assert.deepEqual(parseProgress('Enumerating objects: 5, done.\n'), { phase: 'Enumerating objects', percent: null });
  assert.equal(parseProgress('To github.com:me/repo.git\n'), null);
});

test('failures map to reasons a person can act on', () => {
  const rejected = classifyFailure([
    'To ../remote.git', '!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)', 'Done',
    "error: failed to push some refs to '../remote.git'", 'hint: Updates were rejected because the remote contains work',
  ].join('\n'));
  assert.equal(rejected.reason, 'rejected');
  assert.equal(rejected.message, "!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nerror: failed to push some refs to '../remote.git'");
  assert.equal(classifyFailure('hint: Diverging branches\nfatal: Not possible to fast-forward, aborting.').reason, 'diverged');
  assert.equal(classifyFailure('error: Your local changes to the following files would be overwritten by merge:\n\tf.txt').reason, 'dirty');
  assert.equal(classifyFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled").reason, 'auth');
  assert.equal(classifyFailure('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.').reason, 'auth');
  assert.equal(classifyFailure("ssh: Could not resolve hostname github.com\nfatal: Could not read from remote repository.").reason, 'network');
  assert.equal(classifyFailure("fatal: Unable to create '/r/.git/index.lock': File exists.").reason, 'locked');
  assert.deepEqual(classifyFailure(''), { reason: 'unknown', message: 'git exited with an error.' });
});

test('push porcelain lists each ref with its flag', () => {
  assert.deepEqual(parsePushPorcelain('To ../r.git\n*\trefs/heads/x:refs/heads/x\t[new branch]\n \trefs/heads/main:refs/heads/main\ta..b\nDone\n'), [
    { flag: '*', from: 'refs/heads/x', to: 'refs/heads/x', summary: '[new branch]' },
    { flag: ' ', from: 'refs/heads/main', to: 'refs/heads/main', summary: 'a..b' },
  ]);
});
