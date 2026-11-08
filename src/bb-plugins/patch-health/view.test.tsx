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
  return renderSlot({ component: PatchView }, { snapshot, repair: null, hostId: 'host-example', loading: false, error: null, onRefresh: () => {}, onClose: () => {}, ...extra });
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
  expect(view.getByRole('alert').textContent).toContain('Previous results are not shown as current');
});
test('refresh does not display old results as a new observation', () => {
  const view = render(sample(), { loading: true });
  expect(view.queryByRole('button', { name: /Workflow activity/ })).toBeNull();
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
