import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, onKey, setQuery, type Key, type PickerState } from './picker.ts';
import { filterRows, parseListLines } from './rows.ts';

const all = parseListLines(['mine/  (2)', 'mine/tdd  t', 'mine/typescript  ts', 'expo/  (1)', 'expo/expo-router']);
const key = (partial: Partial<Key> & { key: string }): Key =>
  ({ code: '', ctrl: false, alt: false, shift: false, meta: false, ...partial });

function press(state: PickerState, keys: Key[], query = state.query) {
  let current = setQuery(state, query);
  const visible = filterRows(all, current.query);
  let effect = onKey(current, key({ key: 'Unidentified' }), visible, all).effect;
  for (const k of keys) {
    const step = onKey(current, k, visible, all);
    current = step.state;
    effect = step.effect;
  }
  return { state: current, effect };
}

test('enter with nothing marked loads the cursor row', () => {
  const { effect } = press(initialState, [key({ key: 'ArrowDown' }), key({ key: 'Enter' })]);
  assert.deepEqual(effect, { kind: 'load', refs: ['mine/tdd'] });
});

test('enter on a folder row loads the group ref', () => {
  const { effect } = press(initialState, [key({ key: 'Enter' })], 'expo');
  assert.deepEqual(effect, { kind: 'load', refs: ['expo/'] });
});

test('tab marks and moves down; marks load in list order, not mark order', () => {
  const { state, effect } = press(initialState, [
    key({ key: 'ArrowDown' }), key({ key: 'ArrowDown' }), key({ key: 'Tab' }),
    key({ key: 'ArrowUp' }), key({ key: 'ArrowUp' }), key({ key: 'Tab' }),
    key({ key: 'Enter' }),
  ]);
  assert.deepEqual(state.marked, ['mine/typescript', 'mine/tdd']);
  assert.deepEqual(effect, { kind: 'load', refs: ['mine/tdd', 'mine/typescript'] });
});

test('tab on a marked row unmarks it', () => {
  const { state } = press(initialState, [key({ key: 'Tab' }), key({ key: 'ArrowUp' }), key({ key: 'Tab' })]);
  assert.deepEqual(state.marked, []);
});

test('marks survive a filter change that hides them', () => {
  const marked = press(initialState, [key({ key: 'Tab' })]).state;
  const { effect } = press(marked, [key({ key: 'Enter' })], 'expo');
  assert.deepEqual(effect, { kind: 'load', refs: ['mine/'] });
});

test('ctrl-y copies and alt-i installs, matched on code so macOS Alt glyphs work', () => {
  assert.deepEqual(press(initialState, [key({ key: 'y', code: 'KeyY', ctrl: true })]).effect, { kind: 'copy', refs: ['mine/'] });
  assert.deepEqual(press(initialState, [key({ key: 'ˆ', code: 'KeyI', alt: true })]).effect, { kind: 'install', refs: ['mine/'] });
});

test('ctrl-/ toggles the preview, which starts hidden', () => {
  assert.equal(initialState.preview, false);
  assert.equal(press(initialState, [key({ key: '/', code: 'Slash', ctrl: true })]).state.preview, true);
});

test('the cursor clamps at both ends and resets when the query changes', () => {
  const down = press(initialState, Array.from({ length: 9 }, () => key({ key: 'ArrowDown' })));
  assert.equal(down.state.cursor, 4);
  assert.equal(press(initialState, [key({ key: 'ArrowUp' })]).state.cursor, 0);
  assert.equal(setQuery(down.state, 'ex').cursor, 0);
});

test('acting on an empty filter does nothing; escape closes; other keys pass through', () => {
  assert.deepEqual(press(initialState, [key({ key: 'Enter' })], 'zzz').effect, { kind: 'none' });
  assert.deepEqual(press(initialState, [key({ key: 'Escape' })]).effect, { kind: 'close' });
  assert.equal(onKey(initialState, key({ key: 'a', code: 'KeyA' }), all, all).handled, false);
});
