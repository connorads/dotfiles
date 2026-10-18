// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { StateView } from './contracts.ts';
import { close, toggle } from './store.ts';

const app = await loadPluginApp(() => import('./app.tsx'));

// jsdom has no modal dialogs; the chip package's tests stub them the same way.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

afterEach(() => {
  close();
  cleanup();
});

const connection = (id: string, name: string, extra: Partial<StateView['connections'][number]> = {}) =>
  ({ id, name, url: `https://mcp.executor.sh/mcp?connection=${id}`, status: 'signed-in' as const, isDefault: false, ...extra });

function stateOf(partial: Partial<StateView>): StateView {
  return { connections: [], signIns: [], errors: {}, toolsReady: true, ...partial };
}

it('settings: adds a connection, then starts its sign-in', async () => {
  let view = stateOf({});
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: {
      state: () => view,
      add: input => {
        view = stateOf({ connections: [connection('coding', (input as { name: string }).name, { status: 'signed-out', isDefault: true })] });
        return { ok: true, id: 'coding' };
      },
      signIn: () => null,
    },
  });
  expect(await slot.findByText('No connections yet.')).toBeTruthy();
  fireEvent.change(slot.getByRole('textbox', { name: 'Connection name' }), { target: { value: 'Coding' } });
  fireEvent.change(slot.getByRole('textbox', { name: 'Connection URL' }), { target: { value: 'https://mcp.executor.sh/mcp?connection=c_1' } });
  fireEvent.click(slot.getByRole('button', { name: 'Add and sign in' }));
  await waitFor(() => expect(slot.rpcCalls.map(c => c.method)).toContain('signIn'));
  expect(slot.rpcCalls.find(c => c.method === 'add')?.input).toEqual({ name: 'Coding', url: 'https://mcp.executor.sh/mcp?connection=c_1' });
  expect(slot.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ id: 'coding' });
});

it('settings: shows why a URL was refused', async () => {
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: { state: () => stateOf({}), add: () => ({ ok: false, message: 'That is not an Executor MCP URL. It ends in /mcp.' }) },
  });
  await slot.findByText('No connections yet.');
  fireEvent.change(slot.getByRole('textbox', { name: 'Connection name' }), { target: { value: 'X' } });
  fireEvent.change(slot.getByRole('textbox', { name: 'Connection URL' }), { target: { value: 'https://example.com' } });
  fireEvent.click(slot.getByRole('button', { name: 'Add and sign in' }));
  expect((await slot.findByRole('alert')).textContent).toBe('That is not an Executor MCP URL. It ends in /mcp.');
  expect(slot.rpcCalls.some(c => c.method === 'signIn')).toBe(false);
});

it('settings: shows the device code while waiting and refetches on realtime', async () => {
  let view = stateOf({
    connections: [connection('coding', 'Coding', { status: 'signing-in', isDefault: true })],
    signIns: [{ id: 'coding', userCode: 'WXYZ-QRST', verificationUri: 'https://app.executor.sh/device', verificationUriComplete: 'https://app.executor.sh/device?code=WXYZ-QRST', expiresAt: Date.now() + 600_000 }],
  });
  const slot = renderSlot(app.settingsSections[0]!, {}, { rpc: { state: () => view } });
  expect(await slot.findByText('WXYZ-QRST')).toBeTruthy();
  expect(slot.getByRole('link', { name: 'Open Executor' }).getAttribute('href')).toBe('https://app.executor.sh/device?code=WXYZ-QRST');
  fireEvent.click(slot.getByRole('button', { name: 'Copy code' }));
  await waitFor(() => expect(slot.experimental_clipboardWrites).toEqual([{ text: 'WXYZ-QRST' }]));
  view = stateOf({ connections: [connection('coding', 'Coding', { isDefault: true })] });
  await slot.emitRealtime('state', null);
  expect(await slot.findByText('Signed in')).toBeTruthy();
  expect(slot.queryByText('WXYZ-QRST')).toBeNull();
});

it('settings: asks twice before removing a connection', async () => {
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: { state: () => stateOf({ connections: [connection('coding', 'Coding', { isDefault: true })] }), remove: () => null },
  });
  fireEvent.click(await slot.findByRole('button', { name: 'Remove' }));
  expect(slot.rpcCalls.some(c => c.method === 'remove')).toBe(false);
  fireEvent.click(slot.getByRole('button', { name: 'Confirm remove' }));
  await waitFor(() => expect(slot.rpcCalls.find(c => c.method === 'remove')?.input).toEqual({ id: 'coding' }));
});
const two = stateOf({ connections: [connection('coding', 'Coding', { isDefault: true }), connection('ops', 'Ops', { status: 'signed-out' })] });

it('chip: names the default connection and hides with no connections', async () => {
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-chip', isCompactViewport: false } as never, {
    rpc: { state: () => two, threadChoice: () => ({ kind: 'default' }) },
  });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { state: () => two, threadChoice: () => ({ kind: 'default' }) } });
  expect(await chip.findByRole('button', { name: 'Executor: Coding (default)' })).toBeTruthy();
  overlay.unmount();
  chip.unmount();
  const empty = { state: () => stateOf({}), threadChoice: () => ({ kind: 'default' }) };
  const overlayEmpty = renderSlot(app.appOverlays[0]!, {}, { rpc: empty });
  const hidden = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-empty', isCompactViewport: false } as never, { rpc: empty });
  await waitFor(() => expect(overlayEmpty.rpcCalls.some(c => c.method === 'state')).toBe(true));
  await waitFor(() => expect(hidden.queryByRole('button')).toBeNull());
});

it('chip: switches a thread by key and marks a signed-out choice', async () => {
  let choice: unknown = { kind: 'default' };
  const handlers = {
    state: () => two,
    threadChoice: () => choice,
    setThreadChoice: (input: unknown) => { choice = (input as { choice: unknown }).choice; return null; },
    signIn: () => null,
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-key', isCompactViewport: false } as never, { rpc: handlers });
  await chip.findByRole('button', { name: 'Executor: Coding (default)' });
  act(() => toggle('t-key', 'keyboard'));
  const dialog = await overlay.findByRole('dialog', { name: 'Executor connection' });
  await waitFor(() => expect(overlay.getByRole('button', { name: /Default/ }).getAttribute('aria-pressed')).toBe('true'));
  fireEvent.keyDown(dialog, { key: '2' });
  await waitFor(() => expect(choice).toEqual({ kind: 'connection', id: 'ops' }));
  expect(overlay.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ id: 'ops' });
  expect(await chip.findByRole('button', { name: 'Executor: Ops, signed out' })).toBeTruthy();
});

it('chip: turns Executor off for a thread', async () => {
  let choice: unknown = { kind: 'default' };
  const handlers = {
    state: () => two,
    threadChoice: () => choice,
    setThreadChoice: (input: unknown) => { choice = (input as { choice: unknown }).choice; return null; },
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-off', isCompactViewport: false } as never, { rpc: handlers });
  await chip.findByRole('button', { name: /Executor: Coding/ });
  act(() => toggle('t-off', 'pointer'));
  fireEvent.click(await overlay.findByRole('button', { name: /Off/ }));
  await waitFor(() => expect(choice).toEqual({ kind: 'off' }));
  expect(await chip.findByRole('button', { name: 'Executor is off for this thread' })).toBeTruthy();
  await waitFor(() => expect(overlay.queryByRole('dialog')).toBeNull());
});
