import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyAction, type Screen } from './keys.ts';

const off: Screen = { kind: 'off', stuck: false };
const onTimed: Screen = { kind: 'on', timed: true, stuck: false };
const onIndefinite: Screen = { kind: 'on', timed: false, stuck: false };

test('OFF starts, opens the lid picker and arms agents mode', () => {
  assert.deepEqual(keyAction(off, 'i'), { kind: 'start', secs: 0 });
  assert.deepEqual(keyAction(off, '1'), { kind: 'start', secs: 1800 });
  assert.deepEqual(keyAction(off, '5'), { kind: 'start', secs: 28800 });
  assert.deepEqual(keyAction(off, 't'), { kind: 'focus', row: 'start:1800' });
  assert.deepEqual(keyAction(off, 'a'), { kind: 'agents' });
  assert.deepEqual(keyAction(off, 'l'), { kind: 'lidPicker' });
  assert.equal(keyAction(off, '6'), null);
  assert.equal(keyAction(off, '0'), null);
});

test('c clears only when the flag is stuck, and never from a lid session', () => {
  assert.equal(keyAction(off, 'c'), null);
  assert.deepEqual(keyAction({ kind: 'off', stuck: true }, 'c'), { kind: 'clear' });
  assert.deepEqual(keyAction({ kind: 'on', timed: true, stuck: true }, 'c'), { kind: 'clear' });
  assert.deepEqual(keyAction({ kind: 'agents', stuck: true }, 'c'), { kind: 'clear' });
  assert.equal(keyAction({ kind: 'agents', stuck: false }, 'c'), null);
  assert.equal(keyAction({ kind: 'lid' }, 'c'), null);
});

test('the lid picker starts timed lid sessions and Esc goes back', () => {
  const picker: Screen = { kind: 'lid-picker' };
  assert.deepEqual(keyAction(picker, '2'), { kind: 'startLid', secs: 3600 });
  assert.equal(keyAction(picker, 'i'), null);
  assert.equal(keyAction(picker, '6'), null);
  assert.deepEqual(keyAction(picker, 'Escape'), { kind: 'back' });
});

test('ON extends a timed session by 1-4 and turns off with o', () => {
  assert.deepEqual(keyAction(onTimed, '1'), { kind: 'extend', add: 1800 });
  assert.deepEqual(keyAction(onTimed, '4'), { kind: 'extend', add: 14400 });
  assert.equal(keyAction(onTimed, '5'), null);
  assert.deepEqual(keyAction(onTimed, '+'), { kind: 'focus', row: 'extend:1800' });
  assert.deepEqual(keyAction(onTimed, '='), { kind: 'focus', row: 'extend:1800' });
  assert.deepEqual(keyAction(onTimed, 'o'), { kind: 'off' });
  assert.deepEqual(keyAction({ kind: 'lid' }, '2'), { kind: 'extend', add: 3600 });
});

test('an indefinite session and agents mode have nothing to extend', () => {
  for (const key of ['+', '=', '1']) {
    assert.equal(keyAction(onIndefinite, key), null);
    assert.equal(keyAction({ kind: 'agents', stuck: false }, key), null);
  }
  assert.deepEqual(keyAction({ kind: 'agents', stuck: false }, 'o'), { kind: 'off' });
});

test('Space is never remapped, so it activates the focused row', () => {
  for (const screen of [off, onTimed, onIndefinite, { kind: 'lid' }, { kind: 'agents', stuck: false }, { kind: 'lid-picker' }] as Screen[]) {
    assert.equal(keyAction(screen, ' '), null);
  }
});

test('q and Esc close everywhere else; unsupported takes nothing more', () => {
  for (const screen of [off, onTimed, { kind: 'agents', stuck: false }, { kind: 'unsupported' }] as Screen[]) {
    assert.deepEqual(keyAction(screen, 'q'), { kind: 'close' });
    assert.deepEqual(keyAction(screen, 'Escape'), { kind: 'close' });
  }
  assert.equal(keyAction({ kind: 'unsupported' }, 'i'), null);
});
