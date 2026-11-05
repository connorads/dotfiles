import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listKey } from './keys.ts';

// Off, two sets, New set.
const rows = 4;

test('number keys choose Off and each set', () => {
  assert.deepEqual(listKey('0', 2, rows), { kind: 'choose', row: 0 });
  assert.deepEqual(listKey('2', 0, rows), { kind: 'choose', row: 2 });
});

test('number keys never reach New set or missing sets', () => {
  assert.equal(listKey('3', 0, rows), null);
  assert.equal(listKey('9', 0, rows), null);
});

test('arrows wrap', () => {
  assert.deepEqual(listKey('ArrowDown', 3, rows), { kind: 'move', row: 0 });
  assert.deepEqual(listKey('ArrowUp', 0, rows), { kind: 'move', row: 3 });
});

test('enter, e and escape act on the highlighted row', () => {
  assert.deepEqual(listKey('Enter', 1, rows), { kind: 'choose', row: 1 });
  assert.deepEqual(listKey('e', 1, rows), { kind: 'edit', row: 1 });
  assert.deepEqual(listKey('Escape', 1, rows), { kind: 'close' });
});

test('other keys pass through', () => {
  assert.equal(listKey('x', 0, rows), null);
});
