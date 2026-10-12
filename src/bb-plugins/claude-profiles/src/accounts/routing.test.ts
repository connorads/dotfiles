import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newThreadAccount, startingThreadId } from './routing.ts';

const work = { hostId: 'h1', profile: { id: 'work', label: 'Work', configDir: '/profiles/work' } };
const native = { hostId: 'h1', profile: { id: 'default', label: 'Default', configDir: null } };

test('the starting thread is the parent, else the source of a fork', () => {
  const none = { originKind: null, sourceThreadId: null };
  assert.equal(startingThreadId(none, 'parent'), 'parent');
  assert.equal(startingThreadId({ originKind: 'fork', sourceThreadId: 'source' }, null), 'source');
  assert.equal(startingThreadId(none, null), null);
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
