// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, within } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { PatchView } from './view';
import { fromInspection, type Snapshot } from './model';
afterEach(cleanup);
function sample(missing: string[] = []) {
  return fromInspection({ schema: 1, classification: missing.length ? 'stock' : 'requested-profile', requiredSet: 'session-options-plus-activity', missingPatches: missing,
    observation: { app: '/Applications/bb.app', identity: { version: '0.48.1' } }, pendingTransaction: null,
    activationStatus: 'unknown', runtimeVerificationStatus: 'unknown' }, missing.length ? 1 : 0, '2026-01-01T12:00:00.000Z');
}
function render(snapshot: Snapshot, extra: { loading?: boolean; error?: string } = {}) {
  return renderSlot({ component: PatchView }, { snapshot, hostId: 'host-example', loading: false, error: null, onRefresh: () => {}, onClose: () => {}, ...extra });
}
test('shows file matches without implying live success and reveals evidence on demand', () => {
  const view = render(sample());
  expect(within(view.getByRole('banner')).getByRole('status').textContent).toBe('Files present. Live checks pending.');
  expect(view.queryByText('Check passed')).toBeNull();
  const row = view.getByRole('button', { name: /Workflow activity/ });
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(view.getByText('Technical details'));
  expect(view.getByText('Not checked')).toBeTruthy();
  expect(within(view.getByRole('region', { name: 'Workflow activity evidence' })).getByText('Unavailable')).toBeTruthy();
});
test('identifies the inspected desktop instead of calling it the running server', () => {
  const view = render(sample(['activity', 'session-options']));
  expect(within(view.getByRole('banner')).getByRole('status').textContent).toBe('2 patches missing from desktop');
  expect(view.getByText('Desktop · 0.48.1')).toBeTruthy();
  fireEvent.click(view.getByText('Installation details'));
  expect(view.getByText('/Applications/bb.app')).toBeTruthy();
  expect(view.getByText(/does not identify the code loaded/)).toBeTruthy();
});
test('connection loss replaces old file results with an explicit unavailable state', () => {
  const view = render(sample(), { error: 'Server connection unavailable' });
  expect(view.queryByRole('button', { name: /Workflow activity/ })).toBeNull();
  expect(view.queryByRole('region', { name: 'Next step' })).toBeNull();
  expect(view.getByRole('alert').textContent).toContain('Previous results are not shown as current');
});
test('refresh does not display old results as a new observation', () => {
  const view = render(sample(), { loading: true });
  expect(view.queryByRole('button', { name: /Workflow activity/ })).toBeNull();
  expect(view.queryByRole('region', { name: 'Next step' })).toBeNull();
  expect(view.getByRole('button', { name: 'Refresh patch status' }).hasAttribute('disabled')).toBe(true);
});
test('arrow keys move between patch rows and preserve ordinary tab access', () => {
  const view = render(sample());
  const first = view.getByRole('button', { name: /Workflow activity/ });
  const second = view.getByRole('button', { name: /Session options/ });
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: 'ArrowUp' }); expect(document.activeElement).toBe(first);
});

test('missing files show an immediate next step and explain why restarting will not fix them', () => {
  const view = render(sample(['activity', 'session-options']));
  const guidance = view.getByRole('region', { name: 'Next step' });
  expect(guidance.textContent).toContain('Check the server setup');
  expect(guidance.textContent).toContain('Restarting BB will not install missing patch files.');
  expect(guidance.textContent).toContain('bb-deploy status');
  expect(view.getByRole('button', { name: 'Copy diagnostic request' })).toBeTruthy();
});
test('matched files require a live check rather than an automatic restart recommendation', () => {
  const view = render(sample());
  const guidance = view.getByRole('region', { name: 'Next step' });
  expect(guidance.textContent).toContain('Verify the running feature');
  expect(guidance.textContent).toContain('Activation is unknown');
  expect(guidance.textContent).not.toContain('Restart BB now');
});
test('an unfinished transaction takes priority over ordinary missing-patch advice', () => {
  const snapshot = sample(['activity', 'session-options']);
  if (snapshot.kind !== 'available') throw Error('Expected available fixture');
  const view = render({ ...snapshot, pendingState: 'installing' });
  expect(view.getByRole('region', { name: 'Next step' }).textContent).toContain('Review the patch transaction');
});
test('unrecognised bytes and unavailable inspection never recommend installing or restarting', () => {
  const snapshot = sample();
  if (snapshot.kind !== 'available') throw Error('Expected available fixture');
  const view = render({ ...snapshot, classification: 'unknown', patches: snapshot.patches.map(patch => ({ ...patch, files: 'unverified' })) });
  expect(view.getByRole('region', { name: 'Next step' }).textContent).toContain('Inspect the unrecognised files');
  cleanup();
  const missing = render({ kind: 'unavailable', app: '/Applications/bb.app', reason: 'Inspector missing', observedAt: snapshot.observedAt });
  expect(missing.getByRole('region', { name: 'Next step' }).textContent).toContain('Restore inspection');
});
