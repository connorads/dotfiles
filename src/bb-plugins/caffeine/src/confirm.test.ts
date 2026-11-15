import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARMED_MS, press, SECOND_PRESS_MS } from './confirm.ts';

const row = 'lid:1800';

test('on mains a lid row starts at the first press', () => {
  assert.deepEqual(press(null, row, 0, true), { go: true });
});

test('off mains the first press only arms the row', () => {
  assert.deepEqual(press(null, row, 1_000, false), { go: false, armed: { row, at: 1_000 } });
});

test('a deliberate second press of the same row goes', () => {
  const armed = { row, at: 1_000 };
  assert.deepEqual(press(armed, row, 1_000 + SECOND_PRESS_MS, false), { go: true });
  assert.deepEqual(press(armed, row, 1_000 + ARMED_MS - 1, false), { go: true });
});

test('a second press too soon is the same gesture and keeps the first arming', () => {
  const armed = { row, at: 1_000 };
  assert.deepEqual(press(armed, row, 1_050, false), { go: false, armed });
  assert.deepEqual(press(armed, row, 1_000 + SECOND_PRESS_MS - 1, false), { go: false, armed });
});

test('another row, or a press after the wait, arms afresh', () => {
  const armed = { row, at: 1_000 };
  assert.deepEqual(press(armed, 'lid:3600', 2_000, false), { go: false, armed: { row: 'lid:3600', at: 2_000 } });
  assert.deepEqual(press(armed, row, 1_000 + ARMED_MS, false), { go: false, armed: { row, at: 1_000 + ARMED_MS } });
});
