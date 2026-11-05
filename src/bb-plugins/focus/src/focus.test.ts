import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activate, addSet, deactivate, hiddenGroups, initialState, LOOSE_THREADS, removeSet, renameSet, setMask, setProject, swapTarget,
  type FocusState,
} from './focus.ts';

const base: FocusState = {
  sets: [
    { id: 'work', name: 'Work', projects: ['a'], mask: 'off' },
    { id: 'demo', name: 'Demo', projects: [], mask: 'hide-rest' },
  ],
  active: null,
  lastSetId: null,
};

test('starts with an empty Demo set that hides the rest', () => {
  assert.deepEqual(initialState.sets, [{ id: 'demo', name: 'Demo', projects: [], mask: 'hide-rest' }]);
});

test('activating records the sidebar to restore', () => {
  const state = activate(base, 'work', ['section:x']);
  assert.deepEqual(state.active, { setId: 'work', restore: ['section:x'] });
  assert.equal(state.lastSetId, 'work');
});

test('switching sets keeps the original restore point', () => {
  const state = activate(activate(base, 'work', ['section:x']), 'demo', ['project:b']);
  assert.deepEqual(state.active, { setId: 'demo', restore: ['section:x'] });
});

test('activating an unknown set changes nothing', () => {
  assert.equal(activate(base, 'gone', []), base);
});

test('deactivating returns the restore point once', () => {
  const stopped = deactivate(activate(base, 'work', ['section:x']));
  assert.deepEqual(stopped.restore, ['section:x']);
  assert.equal(stopped.state.active, null);
  assert.equal(deactivate(stopped.state).restore, null);
});

test('a double press targets the last set, then the first, and off while on', () => {
  assert.equal(swapTarget(base), 'work');
  const used = deactivate(activate(base, 'demo', [])).state;
  assert.equal(swapTarget(used), 'demo');
  assert.equal(swapTarget(activate(base, 'work', [])), null);
  assert.equal(swapTarget({ ...base, sets: [] }), null);
});

test('an empty set hides every project and stays empty', () => {
  const state = activate(base, 'demo', []);
  assert.deepEqual(state.sets[1]?.projects, []);
  assert.deepEqual(hiddenGroups(state, ['a', 'b']), [LOOSE_THREADS, 'project:a', 'project:b']);
});

test('hiddenGroups shows the set and keeps hidden sections', () => {
  const state = activate(base, 'work', ['section:x', 'project:old', LOOSE_THREADS]);
  assert.deepEqual(hiddenGroups(state, ['a', 'b']), ['section:x', LOOSE_THREADS, 'project:b']);
});

test('hiddenGroups is null while off', () => {
  assert.equal(hiddenGroups(base, ['a']), null);
});

test('sets can be added, renamed and masked', () => {
  const state = setMask(renameSet(addSet(base, 'new', 'New'), 'new', 'Client'), 'new', 'hide-rest');
  assert.deepEqual(state.sets[2], { id: 'new', name: 'Client', projects: [], mask: 'hide-rest' });
});

test('project ticks do not duplicate and only touch one set', () => {
  const added = setProject(setProject(base, 'work', 'b', true), 'work', 'b', true);
  assert.deepEqual(added.sets[0]?.projects, ['a', 'b']);
  assert.deepEqual(added.sets[1]?.projects, []);
  assert.deepEqual(setProject(added, 'work', 'a', false).sets[0]?.projects, ['b']);
});

test('removing the last used set clears the double press target', () => {
  const state = removeSet({ ...base, lastSetId: 'demo' }, 'demo');
  assert.equal(state.lastSetId, null);
  assert.deepEqual(state.sets.map(set => set.id), ['work']);
});
