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

test('an unbound parent, a parent on Default and no parent all use the composer account', () => {
  for (const parent of [null, native]) {
    assert.deepEqual(newThreadAccount(parent, 'personal'), { kind: 'composer', profileId: 'personal' });
    assert.deepEqual(newThreadAccount(parent, 'default'), { kind: 'default' });
    assert.deepEqual(newThreadAccount(parent, null), { kind: 'default' });
  }
});
