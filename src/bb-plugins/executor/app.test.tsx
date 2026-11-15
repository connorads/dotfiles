// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { StateView } from './contracts.ts';
import { close, toggle, resetDraft } from './store.ts';

const app = await loadPluginApp(() => import('./app.tsx'));

// jsdom has no modal dialogs; the chip package's tests stub them the same way.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

afterEach(() => {
  close();
  cleanup();
  resetDraft();
});

const connection = (id: string, name: string, extra: Partial<StateView['connections'][number]> = {}) =>
  ({ id, name, url: `https://mcp.executor.sh/mcp?connection=${id}`, status: 'signed-in' as const, isDefault: false, ...extra });

function stateOf(partial: Partial<StateView>): StateView {
  return { connections: [], signIns: [], errors: {}, toolsReady: true, ...partial };
}

// The store is shared by the whole file, so these run before any read succeeds.
it('popover: a failed state read says why instead of loading forever', async () => {
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { state: () => { throw new Error('Executor plugin server is not responding.'); }, threadChoice: () => ({ kind: 'default' }) },
  });
  act(() => toggle('t-failed', 'keyboard'));
  const alert = await overlay.findByRole('alert');
  expect(alert.textContent).toContain('Executor plugin server is not responding.');
  expect(overlay.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('settings: a failed state read says why and loads again on Try again', async () => {
  let fail = true;
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: { state: () => { if (fail) throw new Error('Executor plugin server is not responding.'); return stateOf({}); } },
  });
  expect((await slot.findByRole('alert')).textContent).toContain('Executor plugin server is not responding.');
  fail = false;
  fireEvent.click(slot.getByRole('button', { name: 'Try again' }));
  expect(await slot.findByText('No connections yet.')).toBeTruthy();
});

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
  expect(slot.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ id: 'coding', method: 'browser' });
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
    signIns: [{ kind: 'device', id: 'coding', userCode: 'WXYZ-QRST', verificationUri: 'https://app.executor.sh/device', verificationUriComplete: 'https://app.executor.sh/device?code=WXYZ-QRST', expiresAt: Date.now() + 600_000 }],
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

function draftSurface(blocked?: string) {
  const action = app.composerCustomizations.find(c => c.id === 'connection')?.actions?.[0];
  const overlay = app.appOverlays[0];
  if (!action || !overlay) throw new Error('Missing Executor composer surfaces.');
  const Action = action.component;
  const Overlay = overlay.component;
  return renderSlot({ component: () => <><form data-promptbox aria-label="New thread">
    <div contentEditable role="textbox" aria-label="Prompt" />
    <Action />
  </form><Overlay /></> }, {}, {
    composer: { scope: { kind: 'new-thread', projectId: 'project-test' }, text: 'Synthetic prompt', submittingBlockedReason: blocked },
    rpc: { state: () => two },
  });
}

it.each(['Enter', 'Meta+Enter', 'Control+Enter', 'submit'])('draft: Off travels with %s before a thread exists and resets after sending', async method => {
  const slot = draftSurface();
  fireEvent.click(await slot.findByRole('button', { name: 'Executor: Coding (default)' }));
  const off = await slot.findByRole('button', { name: /Off.*no Executor tools/ });
  expect(off.hasAttribute('disabled')).toBe(false);
  fireEvent.click(off);
  await slot.findByRole('button', { name: 'Executor is off for this new thread' });
  if (method === 'submit') fireEvent.submit(slot.getByRole('form'));
  else fireEvent.keyDown(slot.getByRole('textbox'), { key: 'Enter', metaKey: method === 'Meta+Enter', ctrlKey: method === 'Control+Enter' });
  await waitFor(() => expect(slot.inspection.composer.submits).toEqual([{ experimental_data: { executorChoice: { kind: 'off' } } }]));
  await slot.findByRole('button', { name: 'Executor: Coding (default)' });
  expect(slot.rpcCalls.some(c => c.method === 'setThreadChoice')).toBe(false);
});

it('draft: keyboard selects a connection, and leaving the draft restores the default', async () => {
  const slot = draftSurface();
  await slot.findByRole('button', { name: 'Executor: Coding (default)' });
  act(() => toggle(null, 'keyboard'));
  fireEvent.keyDown(await slot.findByRole('dialog'), { key: '1' });
  await slot.findByRole('button', { name: 'Executor: Coding' });
  fireEvent.submit(slot.getByRole('form'));
  await waitFor(() => expect(slot.inspection.composer.submits[0]).toEqual({ experimental_data: { executorChoice: { kind: 'connection', id: 'coding' } } }));
  slot.unmount();
  const next = draftSurface();
  await next.findByRole('button', { name: 'Executor: Coding (default)' });
});

it('draft: failed sends keep Off and show the reason', async () => {
  const slot = draftSurface('Finish uploading first.');
  fireEvent.click(await slot.findByRole('button', { name: 'Executor: Coding (default)' }));
  fireEvent.click(await slot.findByRole('button', { name: /Off.*no Executor tools/ }));
  fireEvent.submit(slot.getByRole('form'));
  expect((await slot.findByRole('alert')).textContent).toBe('Finish uploading first.');
  await slot.findByRole('button', { name: 'Executor is off for this new thread' });
});

it('draft: newline, composition and mention-menu keys do not send', async () => {
  const slot = draftSurface();
  const editor = slot.getByRole('textbox');
  fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
  const menu = document.createElement('div');
  menu.setAttribute('role', 'listbox');
  document.body.append(menu);
  fireEvent.keyDown(editor, { key: 'Enter' });
  menu.remove();
  expect(slot.inspection.composer.submits).toEqual([]);
});

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
  expect(overlay.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ id: 'ops', method: 'browser' });
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

it('popover: adds a connection by key, selects it for the thread and starts its sign-in', async () => {
  let view = two;
  let choice: unknown = { kind: 'default' };
  const handlers = {
    state: () => view,
    threadChoice: () => choice,
    setThreadChoice: (input: unknown) => { choice = (input as { choice: unknown }).choice; return null; },
    add: (input: unknown) => {
      const { name } = input as { name: string };
      view = stateOf({ connections: [...two.connections, connection('connection-3', name, { status: 'signed-out' })] });
      return { ok: true, id: 'connection-3' };
    },
    signIn: () => null,
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  act(() => toggle('t-add', 'keyboard'));
  const dialog = await overlay.findByRole('dialog', { name: 'Executor connection' });
  await overlay.findByRole('button', { name: /Add connection/ });
  fireEvent.keyDown(dialog, { key: 'a' });
  const url = await overlay.findByRole('textbox', { name: 'Connection URL' });
  expect(document.activeElement).toBe(url);
  fireEvent.change(url, { target: { value: 'https://mcp.executor.sh/mcp?connection=c_3' } });
  fireEvent.submit(overlay.getByRole('form', { name: 'Add connection' }));
  await waitFor(() => expect(overlay.rpcCalls.map(c => c.method)).toContain('signIn'));
  expect(overlay.rpcCalls.find(c => c.method === 'add')?.input).toEqual({ name: 'Connection 3', url: 'https://mcp.executor.sh/mcp?connection=c_3' });
  expect(choice).toEqual({ kind: 'connection', id: 'connection-3' });
  expect(overlay.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ id: 'connection-3', method: 'browser' });
  await waitFor(() => expect(overlay.queryByRole('form', { name: 'Add connection' })).toBeNull());
});

it('popover: pasting an MCP URL opens the add form with it filled in', async () => {
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { state: () => two, threadChoice: () => ({ kind: 'default' }) } });
  act(() => toggle('t-paste', 'keyboard'));
  const dialog = await overlay.findByRole('dialog', { name: 'Executor connection' });
  fireEvent.paste(dialog, { clipboardData: { getData: () => ' https://mcp.executor.sh/mcp?connection=c_9 ' } });
  const url = await overlay.findByRole('textbox', { name: 'Connection URL' });
  expect((url as HTMLInputElement).value).toBe('https://mcp.executor.sh/mcp?connection=c_9');
  expect(document.activeElement).toBe(overlay.getByRole('textbox', { name: 'Connection name' }));
});

it('popover: shows the add form when there are no connections and keeps it open on a refused URL', async () => {
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { state: () => stateOf({}), add: () => ({ ok: false, message: 'That is not an Executor MCP URL. It ends in /mcp.' }) },
  });
  act(() => toggle(null, 'pointer'));
  const url = await overlay.findByRole('textbox', { name: 'Connection URL' });
  fireEvent.change(url, { target: { value: 'https://example.com' } });
  fireEvent.submit(overlay.getByRole('form', { name: 'Add connection' }));
  expect((await overlay.findByRole('alert')).textContent).toBe('That is not an Executor MCP URL. It ends in /mcp.');
  expect(overlay.rpcCalls.find(c => c.method === 'add')?.input).toEqual({ name: 'Connection 1', url: 'https://example.com' });
  expect(overlay.getByRole('form', { name: 'Add connection' })).toBeTruthy();
});

it('popover: a failed save puts the chip back on the saved connection', async () => {
  const handlers = {
    state: () => two,
    threadChoice: () => ({ kind: 'default' }),
    setThreadChoice: () => { throw new Error('Could not save the choice.'); },
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-fail', isCompactViewport: false } as never, { rpc: handlers });
  await chip.findByRole('button', { name: 'Executor: Coding (default)' });
  act(() => toggle('t-fail', 'keyboard'));
  fireEvent.keyDown(await overlay.findByRole('dialog'), { key: 'o' });
  expect((await overlay.findByRole('alert')).textContent).toBe('Could not turn Executor off. Could not save the choice.');
  expect(await chip.findByRole('button', { name: /^Executor: Coding \(default\)\. Could not turn Executor off\./ })).toBeTruthy();
  expect(overlay.getByRole('button', { name: /Default/ }).getAttribute('aria-pressed')).toBe('true');
  // The rows are free again, so the user can try another pick at once.
  fireEvent.keyDown(overlay.getByRole('dialog'), { key: '1' });
  await waitFor(() => expect(overlay.rpcCalls.filter(c => c.method === 'setThreadChoice')).toHaveLength(2));
});

it('popover: one pick at a time while the save is in flight', async () => {
  let finish: (value: null) => void = () => {};
  const handlers = {
    state: () => two,
    threadChoice: () => ({ kind: 'default' }),
    setThreadChoice: () => new Promise<null>(resolve => { finish = resolve; }),
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  act(() => toggle('t-pending', 'keyboard'));
  const dialog = await overlay.findByRole('dialog');
  await overlay.findByRole('button', { name: /Off/ });
  fireEvent.keyDown(dialog, { key: 'o' });
  fireEvent.keyDown(dialog, { key: 'o' });
  fireEvent.keyDown(dialog, { key: '1' });
  await waitFor(() => expect(overlay.getByRole('button', { name: /Off/ }).getAttribute('aria-busy')).toBe('true'));
  expect(overlay.rpcCalls.filter(c => c.method === 'setThreadChoice')).toHaveLength(1);
  await act(async () => finish(null));
  await waitFor(() => expect(overlay.queryByRole('dialog')).toBeNull());
});

it('popover: a sign-in failure after adding stays on screen', async () => {
  let view = two;
  const handlers = {
    state: () => view,
    threadChoice: () => ({ kind: 'default' }),
    setThreadChoice: () => null,
    add: () => {
      view = stateOf({ connections: [...two.connections, connection('connection-3', 'Connection 3', { status: 'signed-out' })] });
      return { ok: true, id: 'connection-3' };
    },
    signIn: () => { throw new Error('Executor sign-in is unavailable.'); },
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  act(() => toggle('t-add-fail', 'keyboard'));
  const dialog = await overlay.findByRole('dialog');
  await overlay.findByRole('button', { name: /Add connection/ });
  fireEvent.keyDown(dialog, { key: 'a' });
  fireEvent.change(await overlay.findByRole('textbox', { name: 'Connection URL' }), { target: { value: 'https://mcp.executor.sh/mcp?connection=c_3' } });
  fireEvent.submit(overlay.getByRole('form', { name: 'Add connection' }));
  expect((await overlay.findByRole('alert')).textContent).toBe('The connection was added, but its sign-in did not start. Executor sign-in is unavailable.');
});

it('popover: connections past the ninth are rows without a key', async () => {
  const eleven = stateOf({ connections: Array.from({ length: 11 }, (_, i) => connection(`c${i + 1}`, `Conn ${i + 1}`, { isDefault: i === 0 })) });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { state: () => eleven, threadChoice: () => ({ kind: 'default' }) } });
  act(() => toggle('t-eleven', 'keyboard'));
  const eleventh = await overlay.findByRole('button', { name: /Conn 11/ });
  expect(eleventh.querySelector('kbd')).toBeNull();
  expect(overlay.getByRole('button', { name: /Conn 9/ }).querySelector('kbd')?.textContent).toBe('9');
});

it('settings: a row waits for its request and shows its failure in the row', async () => {
  let finish: (cause: Error) => void = () => {};
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: { state: () => two, signIn: () => new Promise((_, reject) => { finish = reject; }) },
  });
  const signIn = await slot.findByRole('button', { name: 'Sign in' });
  fireEvent.click(signIn);
  fireEvent.click(signIn);
  expect(slot.rpcCalls.filter(c => c.method === 'signIn')).toHaveLength(1);
  expect(signIn.getAttribute('aria-disabled')).toBe('true');
  await act(async () => finish(new Error('Executor sign-in is unavailable.')));
  const alert = await slot.findByRole('alert');
  expect(alert.textContent).toBe('Executor sign-in is unavailable.');
  expect(alert.closest('li')?.textContent).toContain('Ops');
  expect(signIn.hasAttribute('aria-disabled')).toBe(false);
});

it('popover: a choice read that returns after a pick does not undo it', async () => {
  let answer: (choice: unknown) => void = () => {};
  const handlers = {
    state: () => two,
    threadChoice: () => new Promise(resolve => { answer = resolve; }),
    setThreadChoice: () => null,
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  act(() => toggle('t-stale', 'keyboard'));
  const dialog = await overlay.findByRole('dialog');
  await overlay.findByRole('button', { name: /Off/ });
  fireEvent.keyDown(dialog, { key: 'o' });
  await waitFor(() => expect(overlay.queryByRole('dialog')).toBeNull());
  await act(async () => answer({ kind: 'default' }));
  act(() => toggle('t-stale', 'keyboard'));
  await waitFor(() => expect(overlay.getByRole('button', { name: /Off/ }).getAttribute('aria-pressed')).toBe('true'));
});

it('popover: a save that fails after the popover closed marks the chip and explains on reopen', async () => {
  let fail: (cause: Error) => void = () => {};
  const handlers = {
    state: () => two,
    threadChoice: () => ({ kind: 'default' }),
    setThreadChoice: () => new Promise((_, reject) => { fail = reject; }),
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-late', isCompactViewport: false } as never, { rpc: handlers });
  await chip.findByRole('button', { name: 'Executor: Coding (default)' });
  act(() => toggle('t-late', 'keyboard'));
  await overlay.findByRole('button', { name: /Off/ });
  fireEvent.keyDown(overlay.getByRole('dialog'), { key: 'o' });
  act(() => close());
  await act(async () => fail(new Error('Could not save the choice.')));
  expect(await chip.findByRole('button', { name: 'Executor: Coding (default). Could not turn Executor off. Could not save the choice.' })).toBeTruthy();
  act(() => toggle('t-late', 'keyboard'));
  expect((await overlay.findByRole('alert')).textContent).toBe('Could not turn Executor off. Could not save the choice.');
});

it('popover: a save that finishes after the popover closed leaves a reopened popover open', async () => {
  let finish: (value: null) => void = () => {};
  const handlers = {
    state: () => two,
    threadChoice: () => ({ kind: 'default' }),
    setThreadChoice: () => new Promise<null>(resolve => { finish = resolve; }),
  };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  act(() => toggle('t-reopen', 'keyboard'));
  await overlay.findByRole('button', { name: /Off/ });
  fireEvent.keyDown(overlay.getByRole('dialog'), { key: 'o' });
  act(() => close());
  act(() => toggle('t-reopen', 'keyboard'));
  await overlay.findByRole('dialog');
  await act(async () => finish(null));
  expect(overlay.queryByRole('dialog')).toBeTruthy();
});

it('popover: Cancel sends one request while it waits and keeps focus', async () => {
  const pending = stateOf({
    connections: [connection('coding', 'Coding', { status: 'signing-in', isDefault: true })],
    signIns: [{ kind: 'browser', id: 'coding', url: 'https://app.executor.sh/sign-in', expiresAt: Date.now() + 600_000 }],
  });
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { state: () => pending, threadChoice: () => ({ kind: 'default' }), cancelSignIn: () => new Promise(() => {}) },
  });
  act(() => toggle('t-cancel', 'keyboard'));
  const cancel = await overlay.findByRole('button', { name: 'Cancel' });
  cancel.focus();
  fireEvent.click(cancel);
  fireEvent.click(cancel);
  expect(overlay.rpcCalls.filter(c => c.method === 'cancelSignIn')).toHaveLength(1);
  expect(cancel.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(cancel);
});

it('settings: adds a connection with no name as the next numbered one', async () => {
  const slot = renderSlot(app.settingsSections[0]!, {}, {
    rpc: { state: () => two, add: () => ({ ok: true, id: 'connection-3' }), signIn: () => null },
  });
  fireEvent.change(await slot.findByRole('textbox', { name: 'Connection URL' }), { target: { value: 'https://mcp.executor.sh/mcp?connection=c_3' } });
  fireEvent.click(slot.getByRole('button', { name: 'Add and sign in' }));
  await waitFor(() => expect(slot.rpcCalls.find(c => c.method === 'add')?.input).toEqual({ name: 'Connection 3', url: 'https://mcp.executor.sh/mcp?connection=c_3' }));
});

it('chip: shows Off in a narrow header', async () => {
  const handlers = { state: () => two, threadChoice: () => ({ kind: 'off' }) };
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: handlers });
  const chip = renderSlot(app.threadHeaderActions[0]!, { threadId: 't-narrow-off', isCompactViewport: true } as never, { rpc: handlers });
  expect((await chip.findByRole('button', { name: 'Executor is off for this thread' })).textContent).toContain('Off');
  overlay.unmount();
});
