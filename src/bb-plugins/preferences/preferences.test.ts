import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePreferences, parsePreferences } from './preferences.ts';

test('file overrides only matching command and platform', () => {
  const current = parsePreferences({ keyboard: [
    { command: 'thread.previous', platform: 'mac', shortcut: { key: 'ArrowLeft', mod: true } },
    { command: 'thread.next', platform: 'mac', shortcut: { key: ']' } },
    { command: 'thread.next', platform: 'linux', shortcut: { key: ']' } },
  ] }).keyboard;
  const desired = parsePreferences({ keyboard: [
    { command: 'thread.next', platform: 'mac', shortcut: { key: 'L', mod: true, shift: true } },
  ] }).keyboard;
  const result = mergePreferences(current, desired);
  assert.equal(result.length, 3);
  assert.deepEqual(result.slice(0, 2), [current[0], current[2]]);
  assert.deepEqual(result[2], desired[0]);
  assert.deepEqual(mergePreferences(result, desired), result);
});

test('reject invalid and duplicate entries before applying', () => {
  assert.throws(() => parsePreferences({ keyboard: [{ command: 'thread.next', shortcut: { key: 'L', typo: true } }] }));
  assert.throws(() => parsePreferences({ keyboard: [
    { command: 'thread.next', shortcut: null },
    { command: 'thread.next', shortcut: { key: 'L' } },
  ] }));
});
