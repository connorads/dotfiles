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
  const result = mergePreferences(current, desired, []);
  assert.equal(result.length, 3);
  assert.deepEqual(result.slice(0, 2), [current[0], current[2]]);
  assert.deepEqual(result[2], desired[0]);
  assert.deepEqual(mergePreferences(result, desired, desired), result);
});

test('reject invalid and duplicate entries before applying', () => {
  assert.throws(() => parsePreferences({ keyboard: [{ command: 'thread.next', shortcut: { key: 'L', typo: true } }] }));
  assert.throws(() => parsePreferences({ keyboard: [
    { command: 'thread.next', shortcut: null },
    { command: 'thread.next', shortcut: { key: 'L' } },
  ] }));
});


test('removing a managed entry restores default without touching unmanaged platforms', () => {
  const managed = parsePreferences({ keyboard: [
    { command: 'thread.next', platform: 'mac', shortcut: { key: 'L', mod: true, shift: true } },
  ] }).keyboard;
  const unmanaged = parsePreferences({ keyboard: [
    { command: 'thread.next', platform: 'linux', shortcut: { key: 'J', control: true } },
  ] }).keyboard;
  assert.deepEqual(mergePreferences([...managed, ...unmanaged], [], managed), unmanaged);
});

test('file ownership replaces UI edits and supports explicit disable', () => {
  const ui = parsePreferences({ keyboard: [
    { command: 'thread.next', platform: 'mac', shortcut: { key: 'J' } },
  ] }).keyboard;
  const desired = parsePreferences({ keyboard: [
    { command: 'thread.next', platform: 'mac', shortcut: null },
  ] }).keyboard;
  assert.deepEqual(mergePreferences(ui, desired, desired), desired);
});
