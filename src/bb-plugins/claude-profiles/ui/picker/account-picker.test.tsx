// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import { AccountPicker } from './account-picker.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
function TestAccounts() {
  const composer = useComposer();
  return <AccountPicker composer={composer} onClose={() => composer.focus()} />;
}
function renderAccounts(running = false, fail = false) {
  return renderSlot<Record<string, never>, typeof rpcContract>({ component: TestAccounts }, {}, {
    composer: { text: 'Keep my draft', isRunning: running,
      scope: { kind: 'thread', threadId: 'thread-test' }, selection: { providerId: 'claude-code', model: 'opus' } },
    rpc: {
      'connectors.get': () => ({ enabled: false, launch: 'pending', mode: 'account', globalBlocked: false, accounts: {}, profileId: 'default', pending: 0 }),
      'connectors.set': input => ({ enabled: false, launch: 'pending', mode: input.mode, globalBlocked: false, accounts: {}, profileId: 'default', pending: 0 }),
      'connectors.global.set': () => ({ pending: 0 }),
      'connectors.account.set': () => ({ pending: 0 }),
      'connectors.restart': () => ({ pending: 0 }),
      'usage.login': () => { throw new Error('Unused'); },
      'usage.amp': () => { throw new Error('Unused'); },
      'usage.header': () => { throw new Error('Unused'); },
      'usage.inspection': () => { throw new Error('Unused'); },
      'favourites.list': () => [],
      'favourites.add': () => [],
      'favourites.remove': () => [],
      'favourites.setEffort': () => [],
      nextThreadQuota: () => { throw new Error('Unused'); },
      threadAccounts: () => [],
      accounts: () => ({ supported: true, profiles: [
        { id: 'default', label: 'Default', configDir: null },
        { id: 'work', label: 'Work', configDir: '/profiles/work' }], currentId: 'default' }),
      usage: () => ({ status: 'ok', observedAt: Date.now(), message: null, windows: [
        { id: 'seven_day', label: 'Seven days', usedPercent: 80, cost: null,
          resetsAt: new Date(Date.now() + 7 * 86400000 * 0.8).toISOString() }] }),
      choose: input => { if (fail) throw new Error('Switch refused'); return { currentId: input.profileId }; },
    },
  });
}
test('compares weekly use with elapsed time and switches by number without changing draft or model', async () => {
  const slot = renderAccounts();
  try {
    const work = await slot.findByRole('button', { name: 'Switch to Work' });
    await slot.findAllByText('20% elapsed');
    expect(slot.getAllByText('80% used')).toHaveLength(2);
    fireEvent.keyDown(work, { key: '2' });
    await waitFor(() => expect(slot.inspection.composer.focusCount).toBe(1));
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose').map(call => call.input))
      .toEqual([{ threadId: 'thread-test', profileId: 'work' }]);
    expect(slot.inspection.composer.text).toBe('Keep my draft');
    expect(slot.inspection.composer.selection?.model).toBe('opus');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});
test('moves focus with arrows and keeps switch failures visible', async () => {
  const slot = renderAccounts(false, true);
  try {
    const current = await slot.findByRole('button', { name: 'Switch to Default' });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    const work = slot.getByRole('button', { name: 'Switch to Work' });
    expect(document.activeElement).toBe(work);
    fireEvent.keyDown(work, { key: 'Enter' });
    await slot.findByRole('alert');
    expect(slot.getByText('Switch refused')).toBeTruthy();
    expect(slot.inspection.composer.focusCount).toBe(0);
  } finally { slot.lifecycle.unmount(); }
});
test('running turns allow comparison but refuse keyboard switching', async () => {
  const slot = renderAccounts(true);
  try {
    const work = await slot.findByRole('button', { name: 'Switch to Work' });
    fireEvent.keyDown(work, { key: '2' });
    expect(slot.getByText('Stop the turn and clear queued messages before switching.')).toBeTruthy();
    expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
test('moves between account and connector columns and toggles the focused account with C', async () => {
  const slot = renderAccounts();
  try {
    const current = await slot.findByRole('button', { name: 'Switch to Default' });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: 'ArrowRight' });
    const toggle = slot.getByRole('switch', { name: 'Default account connectors' });
    expect(document.activeElement).toBe(toggle);
    fireEvent.keyDown(toggle, { key: 'ArrowDown' });
    const work = slot.getByRole('switch', { name: 'Work account connectors' });
    expect(document.activeElement).toBe(work);
    fireEvent.keyDown(work, { key: 'c' });
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === 'connectors.account.set').map(call => call.input))
      .toEqual([{ threadId: 'thread-test', profileId: 'work', enabled: true }]));
    fireEvent.keyDown(work, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(slot.getByRole('button', { name: 'Switch to Work' }));
    expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
test('leaves native select keys alone and preserves account focus through policy refreshes', async () => {
  const slot = renderAccounts();
  try {
    const work = await slot.findByRole('button', { name: 'Switch to Work' });
    const select = slot.getByRole('combobox', { name: "This thread's connectors" });
    select.focus();
    expect(fireEvent.keyDown(select, { key: 'ArrowDown' })).toBe(true);
    expect(document.activeElement).toBe(select);
    fireEvent.keyDown(select, { key: '2' });
    expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
    work.focus();
    await slot.behavior.emitRealtime('profiles-changed', {});
    await waitFor(() => expect(slot.getByRole('button', { name: 'Switch to Work' })).toBe(work));
    expect(document.activeElement).toBe(work);
  } finally { slot.lifecycle.unmount(); }
});
