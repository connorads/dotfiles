import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newThreadAccount, startingThread } from './routing.ts';

const work = { hostId: 'h1', profile: { id: 'work', label: 'Work', configDir: '/profiles/work' } };
const native = { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } };

test('the starting thread is the parent, else the source of a fork, else the origin of a workflow run', () => {
  const none = { originKind: null, sourceThreadId: null, originPluginId: null, lifecycleOwnerThreadId: null };
  assert.deepEqual(startingThread(none, 'parent'), { id: 'parent', workflow: false });
  assert.deepEqual(startingThread({ ...none, originKind: 'fork', sourceThreadId: 'source' }, null), { id: 'source', workflow: false });
  assert.deepEqual(startingThread({ ...none, originPluginId: 'workflows', lifecycleOwnerThreadId: 'origin' }, null), { id: 'origin', workflow: true });
  assert.equal(startingThread({ ...none, originPluginId: 'other', lifecycleOwnerThreadId: 'owner' }, null), null);
  assert.equal(startingThread(none, null), null);
});

test('a parent on a named account passes that account on, whatever the composer shows', () => {
  assert.deepEqual(newThreadAccount(work, 'personal'), { kind: 'inherit', profileId: 'work', label: 'Work' });
});

test('a parent on Default passes Default on, whatever the composer shows', () => {
  assert.deepEqual(newThreadAccount(native, 'personal'), { kind: 'inherit', profileId: 'default', label: 'Default' });
});

test('an unbound parent and no parent use the composer account', () => {
  assert.deepEqual(newThreadAccount(null, 'personal'), { kind: 'composer', profileId: 'personal' });
  assert.deepEqual(newThreadAccount(null, 'default'), { kind: 'default' });
  assert.deepEqual(newThreadAccount(null, null), { kind: 'default' });
});

test('a fork or workflow worker with no account to inherit stays on Default, whatever the composer shows', () => {
  assert.deepEqual(newThreadAccount(null, 'personal', true), { kind: 'default' });
  assert.deepEqual(newThreadAccount(work, 'personal', true), { kind: 'inherit', profileId: 'work', label: 'Work' });
});
