// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { ConnectorSettings } from './settings.tsx';

const profiles = [
  { id: 'summit', label: 'Summit', configDir: '/p/summit', key: 'S' },
  { id: 'trove', label: 'Trove', configDir: '/p/trove', key: 'T' },
];
const state = (accounts: Record<string, boolean>) => ({ enabled: false, launch: 'pending' as const, mode: 'account' as const,
  accounts, profileId: 'default', restartPending: false });
afterEach(cleanup);
const listed = (list = profiles) => async () => ({ supported: true, target: 'thread', profiles: list, currentId: 'default', pendingId: null });

test('shows a loading line until the accounts arrive', async () => {
  const slot = renderSlot({ component: ConnectorSettings }, {}, {
    rpc: { accounts: () => new Promise(() => {}), 'connectors.get': async () => state({}) } });
  expect((await slot.findByRole('status')).textContent).toBe('Loading accounts…');
});

test('says so when this machine has no saved Claude accounts', async () => {
  const slot = renderSlot({ component: ConnectorSettings }, {}, {
    rpc: { accounts: listed([]), 'connectors.get': async () => state({}) } });
  await waitFor(() => expect(slot.getByRole('status').textContent).toContain('No saved Claude accounts'));
  expect(slot.queryAllByRole('switch')).toEqual([]);
});

test('a failed load offers Try again, which reloads the accounts', async () => {
  let fail = true;
  const slot = renderSlot({ component: ConnectorSettings }, {}, {
    rpc: { accounts: listed(), 'connectors.get': async () => { if (fail) throw new Error('Machine offline'); return state({ trove: true }); } } });
  expect((await slot.findByRole('alert')).textContent).toBe('Machine offline');
  fail = false;
  fireEvent.click(slot.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(slot.getByRole('switch', { name: 'Trove connectors' }).getAttribute('aria-checked')).toBe('true'));
  expect(slot.queryByRole('alert')).toBeNull();
  expect(slot.queryByRole('button', { name: 'Try again' })).toBeNull();
});

test('a second click while a save runs sends no second save', async () => {
  const slot = renderSlot({ component: ConnectorSettings }, {}, {
    rpc: { accounts: listed(), 'connectors.get': async () => state({}), 'connectors.account.set': () => new Promise(() => {}) } });
  const summit = await slot.findByRole('switch', { name: 'Summit connectors' });
  summit.click(); summit.click();
  await waitFor(() => expect(summit.getAttribute('aria-disabled')).toBe('true'));
  expect(summit.textContent).toBe('Saving…');
  slot.getByRole('switch', { name: 'Trove connectors' }).click();
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'connectors.account.set')).toHaveLength(1);
});

test('a saved change shows On even when the reload after it fails', async () => {
  let reads = 0;
  const slot = renderSlot({ component: ConnectorSettings }, {}, {
    rpc: { accounts: listed(), 'connectors.get': async () => { if (reads++ > 0) throw new Error('Machine offline'); return state({}); },
      'connectors.account.set': async () => ({ restarted: 0 }) } });
  const summit = await slot.findByRole('switch', { name: 'Summit connectors' });
  summit.click();
  expect((await slot.findByRole('alert')).textContent).toBe('Machine offline');
  expect(slot.getByRole('switch', { name: 'Summit connectors' }).getAttribute('aria-checked')).toBe('true');
});
