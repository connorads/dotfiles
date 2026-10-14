import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hiddenGroups, initialState, isActive, setAlwaysShow, setMember, start, stop } from './focus.ts';

const projects = ['me', 'client-a', 'client-b', 'wedding'];
const before = ['project:wedding', 'section:sec_1'];

test('an off view hides nothing extra', () => {
  assert.equal(hiddenGroups(initialState, projects), null);
});

test('a view shows its project and the always-shown ones, and hides the rest with loose threads', () => {
  const state = start(setAlwaysShow(initialState, 'me', true), before, 'client-a');
  assert.deepEqual(hiddenGroups(state, projects), ['section:sec_1', 'threads', 'project:client-b', 'project:wedding']);
});

test('starting with nothing picked and no project shows only the always-shown ones', () => {
  const state = start(setAlwaysShow(initialState, 'me', true), [], null);
  assert.deepEqual(hiddenGroups(state, projects), ['threads', 'project:client-a', 'project:client-b', 'project:wedding']);
});

test('a project the user had hidden shows when picked', () => {
  const state = start(initialState, before, 'wedding');
  assert.ok(!hiddenGroups(state, projects)!.includes('project:wedding'));
});

test('stopping returns the sidebar from before the view', () => {
  const stopped = stop(start(initialState, before, 'client-a'));
  assert.deepEqual(stopped.restore, before);
  assert.ok(!isActive(stopped.state));
});

test('stopping an off view restores nothing', () => {
  assert.equal(stop(initialState).restore, null);
});

test('turning the view back on brings back the picked projects, not the current one', () => {
  let state = setMember(start(initialState, [], 'client-a'), [], 'client-b', true);
  state = stop(state).state;
  assert.deepEqual(state.members, ['client-a', 'client-b']);
  state = start(state, before, 'wedding');
  assert.deepEqual(state.members, ['client-a', 'client-b']);
  assert.deepEqual(state.restore, before);
});

test('starting again keeps the running view and its restore point', () => {
  const state = start(initialState, before, 'client-a');
  assert.equal(start(state, ['threads', 'project:me'], 'client-b'), state);
});

test('ticking a project while off turns the view on with the earlier picks too', () => {
  const off = stop(start(initialState, [], 'client-a')).state;
  const state = setMember(off, before, 'client-b', true);
  assert.deepEqual(state.members, ['client-a', 'client-b']);
  assert.deepEqual(state.restore, before);
});

test('unticking a project while off keeps the view off', () => {
  const off = stop(start(initialState, [], 'client-a')).state;
  const state = setMember(off, before, 'client-a', false);
  assert.deepEqual(state.members, []);
  assert.ok(!isActive(state));
});

test('members and always-shown projects add once and remove cleanly', () => {
  let state = start(initialState, [], 'client-a');
  state = setMember(state, [], 'client-a', true);
  state = setMember(state, [], 'client-b', true);
  state = setMember(state, [], 'client-a', false);
  assert.deepEqual(state.members, ['client-b']);
  state = setAlwaysShow(setAlwaysShow(setAlwaysShow(state, 'me', true), 'me', true), 'wedding', true);
  assert.deepEqual(setAlwaysShow(state, 'wedding', false).alwaysShow, ['me']);
});
