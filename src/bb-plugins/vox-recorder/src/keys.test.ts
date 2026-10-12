import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryKey, type KeyInput } from './keys.ts';

const base: KeyInput = { key: '', focus: 'list', modified: false, renaming: false, confirming: false, hasCurrent: true };
const press = (key: string, patch: Partial<KeyInput> = {}) => libraryKey({ ...base, ...patch, key });

test('the list takes j/k and the arrows; the filter types j and k', () => {
  assert.deepEqual(press('j'), { kind: 'move', step: 1 });
  assert.deepEqual(press('k'), { kind: 'move', step: -1 });
  assert.deepEqual(press('ArrowDown'), { kind: 'move', step: 1 });
  assert.equal(press('j', { focus: 'filter' }), null);
});

test('ArrowDown from the filter enters the list on the shown row, so the newest is not skipped', () => {
  assert.deepEqual(press('ArrowDown', { focus: 'filter' }), { kind: 'move', step: 0 });
});

test('letters act on the selected row only from the list', () => {
  assert.deepEqual(press('c'), { kind: 'letter', action: 'copy' });
  assert.deepEqual(press('d'), { kind: 'letter', action: 'delete' });
  assert.deepEqual(press('/'), { kind: 'letter', action: 'filter' });
  assert.equal(press('c', { focus: 'filter' }), null);
  assert.equal(press('c', { hasCurrent: false }), null);
  assert.deepEqual(press('q'), { kind: 'close' });
});

test('Enter inserts from the filter or the list, but a focused button keeps Enter', () => {
  assert.deepEqual(press('Enter'), { kind: 'insert' });
  assert.deepEqual(press('Enter', { focus: 'filter' }), { kind: 'insert' });
  assert.equal(press('Enter', { focus: 'other' }), null);
  assert.equal(press('Enter', { hasCurrent: false }), null);
});

test('a question takes y and n, even from the filter, and blocks Enter', () => {
  const asking = { confirming: true };
  assert.deepEqual(press('y', asking), { kind: 'confirm' });
  assert.deepEqual(press('y', { ...asking, focus: 'filter' }), { kind: 'confirm' });
  assert.deepEqual(press('n', { ...asking, focus: 'other' }), { kind: 'dismiss-confirm' });
  assert.equal(press('Enter', asking), null);
  // Discard names the live recording, so it needs no selected row.
  assert.deepEqual(press('y', { ...asking, hasCurrent: false }), { kind: 'confirm' });
});

test('modifiers and an open rename field leave every key alone', () => {
  assert.equal(press('c', { modified: true }), null);
  assert.equal(press('Enter', { renaming: true }), null);
  assert.equal(press('y', { renaming: true, confirming: true }), null);
});


test('Q dismisses one layer outside text fields, including an empty library', () => {
  for (const key of ['q', 'Q']) {
    assert.deepEqual(press(key, { hasCurrent: false }), { kind: 'close' });
    assert.deepEqual(press(key, { focus: 'other' }), { kind: 'close' });
    assert.deepEqual(press(key, { confirming: true }), { kind: 'dismiss-confirm' });
    assert.equal(press(key, { focus: 'filter' }), null);
    assert.equal(press(key, { focus: 'filter', confirming: true }), null);
    assert.equal(press(key, { renaming: true }), null);
    assert.equal(press(key, { modified: true }), null);
  }
});
