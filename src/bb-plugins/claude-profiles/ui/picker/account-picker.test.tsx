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
function renderAccounts(running = false, fail: 'load' | 'switch' | null = null, pending?: Promise<{ currentId: string }>) {
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
      'favourites.remember': () => [],
      nextThreadQuota: () => { throw new Error('Unused'); },
      threadAccounts: () => [],
      accounts: () => { if (fail === 'load') throw new Error('Accounts unavailable'); return { supported: true, profiles: [
        { id: 'default', label: 'Default', configDir: null, key: null },
        { id: 'work', label: 'Work', configDir: '/profiles/work', key: null }], currentId: 'default', pendingId: null }; },
      usage: () => ({ status: 'ok', observedAt: Date.now(), message: null, windows: [
        { id: 'seven_day', label: 'Seven days', usedPercent: 80, cost: null,
          resetsAt: new Date(Date.now() + 7 * 86400000 * 0.8).toISOString() }] }),
      choose: input => { if (pending) return pending; if (fail === 'switch') throw new Error('Switch refused'); return { currentId: input.profileId }; },
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
  const slot = renderAccounts(false, 'switch');
  try {
    const current = await slot.findByRole('button', { name: 'Switch to Default' });
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    const work = slot.getByRole('button', { name: 'Switch to Work' });
    expect(document.activeElement).toBe(work);
    fireEvent.keyDown(work, { key: 'Enter' });
    await slot.findByRole('alert');
    expect(slot.getByText('Switch refused')).toBeTruthy();
    expect(slot.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(slot.queryByRole('button', { name: 'Refresh accounts' })).toBeNull();
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

test('account loading failures offer an explicitly labelled refresh', async () => {
  const slot = renderAccounts(false, 'load');
  try {
    const refresh = await slot.findByRole('button', { name: 'Refresh accounts' });
    const before = slot.inspection.rpcCalls.filter(call => call.method === 'accounts').length;
    fireEvent.click(refresh);
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === 'accounts')).toHaveLength(before + 1));
    expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('announces the target and blocks controls and dismissal until switching finishes', async () => {
  let finish!: (value: { currentId: string }) => void;
  const pending = new Promise<{ currentId: string }>(resolve => { finish = resolve; });
  const slot = renderAccounts(false, null, pending);
  try {
    const work = await slot.findByRole('button', { name: 'Switch to Work' });
    work.focus();
    fireEvent.click(work);
    await slot.findByText('Switching to Work…');
    const dialog = slot.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    for (const control of Array.from(dialog.querySelectorAll('button, input, select'))) expect(control.matches(':disabled')).toBe(true);
    expect(slot.getByRole('button', { name: 'Switch to Default' }).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(dialog, { key: '2' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(slot.inspection.composer.focusCount).toBe(0);
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose')).toHaveLength(1);
    finish({ currentId: 'work' });
    await waitFor(() => expect(slot.inspection.composer.focusCount).toBe(1));
    await waitFor(() => expect(work.matches(':disabled')).toBe(false));
  } finally { slot.lifecycle.unmount(); }
});
