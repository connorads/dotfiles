import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isArchivedOnly,
  isRecentMode,
  nextArchivedToggle,
  nextToggle,
  parseRestoreLifecycles,
  parseRestoreMode,
} from './mode.ts';

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

test('archived toggle from active shows archived only and remembers active', () => {
  assert.deepEqual(nextArchivedToggle(['active'], ['active']), {
    nextLifecycles: ['archived'],
    restoreLifecycles: ['active'],
  });
  assert.deepEqual(nextArchivedToggle(['archived'], ['active']), {
    nextLifecycles: ['active'],
    restoreLifecycles: ['active'],
  });
});

test('archived toggle from active + archived shows archived only and restores both', () => {
  assert.deepEqual(nextArchivedToggle(['active', 'archived'], ['active']), {
    nextLifecycles: ['archived'],
    restoreLifecycles: ['active', 'archived'],
  });
  assert.deepEqual(nextArchivedToggle(['archived'], ['active', 'archived']), {
    nextLifecycles: ['active', 'archived'],
    restoreLifecycles: ['active', 'archived'],
  });
});

test('parseRestoreLifecycles defaults missing, invalid or archived-only values to active', () => {
  assert.deepEqual(parseRestoreLifecycles(undefined), ['active']);
  assert.deepEqual(parseRestoreLifecycles([]), ['active']);
  assert.deepEqual(parseRestoreLifecycles(['archived']), ['active']);
  assert.deepEqual(parseRestoreLifecycles(['bogus']), ['active']);
  assert.deepEqual(parseRestoreLifecycles(['active', 'archived']), ['active', 'archived']);
});

test('isArchivedOnly is true only for exactly archived', () => {
  assert.equal(isArchivedOnly(['archived']), true);
  assert.equal(isArchivedOnly(['active']), false);
  assert.equal(isArchivedOnly(['active', 'archived']), false);
});
