import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, summarise, type PendingApproval, type WorkerThread } from './decide.ts';

const worker: WorkerThread = {
  id: 'thr_worker',
  title: 'integrate',
  visibility: 'hidden',
  originPluginId: 'workflows',
  lifecycleOwnerThreadId: 'thr_owner',
};

const archive: PendingApproval = {
  id: 'int_1',
  payload: { kind: 'approval', reason: null, subject: { kind: 'command', command: 'gh repo archive connorads/aikira --yes', cwd: null } },
};

test('alerts the owner when a hidden workflow worker waits for approval', () => {
  const alert = decide(worker, archive);
  assert.ok(alert);
  assert.equal(alert.ownerThreadId, 'thr_owner');
  assert.equal(alert.workerThreadId, 'thr_worker');
  assert.equal(alert.interactionId, 'int_1');
  assert.equal(alert.pushBody, 'integrate: gh repo archive connorads/aikira --yes');
  assert.match(alert.ownerMessage, /@thread:thr_worker/);
  assert.match(alert.ownerMessage, /gh repo archive/);
});

test('ignores visible threads, which BB already notifies about', () => {
  assert.equal(decide({ ...worker, visibility: 'visible' }, archive), null);
});

test('ignores hidden threads from other plugins', () => {
  assert.equal(decide({ ...worker, originPluginId: 'vox-recorder' }, archive), null);
});

test('ignores workers with no owner to tell', () => {
  assert.equal(decide({ ...worker, lifecycleOwnerThreadId: null }, archive), null);
});

test('ignores non-approval interactions such as questions', () => {
  assert.equal(decide(worker, { id: 'int_2', payload: { kind: 'request_answer' } }), null);
});

test('falls back to the title fallback, then the id, for the worker name', () => {
  assert.match(decide({ ...worker, title: null, titleFallback: 'find:rovo' }, archive)!.pushBody, /^find:rovo:/);
  assert.match(decide({ ...worker, title: null }, archive)!.pushBody, /^thr_worker:/);
});

test('summarises each approval kind in one short line', () => {
  assert.equal(summarise({ kind: 'file_change' }), 'a file change');
  assert.equal(summarise({ kind: 'permission_grant', toolName: 'Bash' }), 'permission for Bash');
  assert.equal(summarise({ kind: 'plan' }), 'a plan');
  assert.equal(summarise({ kind: 'tool_use', title: 'Edit settings.json' }), 'Edit settings.json');
  assert.equal(summarise(undefined), 'an action');
  const long = summarise({ kind: 'command', command: `echo ${'x'.repeat(500)}` });
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('…'));
});
