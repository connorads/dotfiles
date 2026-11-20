import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecentMode, nextToggle, parseRestoreMode } from './mode.ts';

test('toggling from project switches to chronological and remembers project', () => {
  assert.deepEqual(nextToggle('project', 'machine'), {
    nextMode: 'chronological',
    restoreMode: 'project',
  });
});

test('toggling from machine switches to chronological and remembers machine', () => {
  assert.deepEqual(nextToggle('machine', 'project'), {
    nextMode: 'chronological',
    restoreMode: 'machine',
  });
});

test('toggling from chronological restores the remembered non-chronological mode', () => {
  assert.deepEqual(nextToggle('chronological', 'project'), {
    nextMode: 'project',
    restoreMode: 'project',
  });
  assert.deepEqual(nextToggle('chronological', 'machine'), {
    nextMode: 'machine',
    restoreMode: 'machine',
  });
});

test('parseRestoreMode defaults missing or invalid stored values to project', () => {
  assert.equal(parseRestoreMode(undefined), 'project');
  assert.equal(parseRestoreMode('chronological'), 'project');
  assert.equal(parseRestoreMode(42), 'project');
  assert.equal(parseRestoreMode('machine'), 'machine');
  assert.equal(parseRestoreMode('project'), 'project');
});

test('isRecentMode is true only for chronological', () => {
  assert.equal(isRecentMode('chronological'), true);
  assert.equal(isRecentMode('project'), false);
  assert.equal(isRecentMode('machine'), false);
});
