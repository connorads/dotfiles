// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { LabView } from './lab-view';
import type { LabState } from './lab-model';
afterEach(cleanup);
function render(state: LabState, extra: Partial<Parameters<typeof LabView>[0]> = {}) {
  return renderSlot({ component: LabView }, { state, pending: false, error: null,
    onPrepare: () => {}, onRun: () => {}, onReconcile: () => {}, onRefresh: () => {}, ...extra });
}
function sample(phase: 'ready' | 'rehearsing' | 'checks-pending' | 'interrupted' | 'stopped'): LabState {
  return { kind: 'available', lab: { id: 'bb-patch-lab-example', root: '/example/lab', phase, revision: 7,
    events: ['Candidate prepared'], checks: { offline: 'passed' }, liveActivation: false } };
}
test('the first action prepares a disposable rehearsal and offers no live restart', () => {
  let calls = 0;
  const view = render({ kind: 'none' }, { onPrepare: () => { calls++; } });
  fireEvent.click(view.getByRole('button', { name: 'Prepare rehearsal' }));
  expect(calls).toBe(1);
  expect(view.getByText(/live activation disabled/)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Restart server' })).toBeNull();
});
test('run uses the reviewed operation identity and revision', () => {
  let received: unknown;
  const view = render(sample('ready'), { onRun: (id, revision) => { received = { id, revision }; } });
  fireEvent.click(view.getByRole('button', { name: 'Run rehearsal' }));
  expect(received).toEqual({ id: 'bb-patch-lab-example', revision: 7 });
});
test('health and restart success never become live feature success', () => {
  const state = sample('checks-pending');
  if (state.kind !== 'available') throw Error('Bad fixture');
  state.lab.checks.restart = 'passed';
  const view = render(state);
  expect(view.getByRole('heading', { name: 'Disposable restart passed' })).toBeTruthy();
  expect(view.getByText('Not checked')).toBeTruthy();
  expect(view.queryByText('Both patches are working')).toBeNull();
});
test('active workers cannot be started again', () => {
  const view = render(sample('rehearsing'));
  expect(view.queryByRole('button', { name: 'Run rehearsal' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Prepare fresh rehearsal' })).toBeNull();
});
test('an interrupted operation exposes inspection instead of blind retry', () => {
  const view = render(sample('interrupted'));
  expect(view.getByRole('button', { name: 'Inspect and stop lab' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Run rehearsal' })).toBeNull();
});
test('pending or disconnected actions stay disabled', () => {
  const view = render(sample('ready'), { pending: false, error: 'Disconnected' });
  expect(view.getByRole('button', { name: 'Run rehearsal' }).hasAttribute('disabled')).toBe(true);
  expect(view.getByRole('alert').textContent).toBe('Disconnected');
});

test('a stopped lab offers a fresh rehearsal after recovery', () => {
  const view = render(sample('stopped'));
  expect(view.getByRole('heading', { name: 'Lab stopped safely' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Prepare fresh rehearsal' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Inspect and stop lab' })).toBeNull();
});
