// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import type { StateView, ThreadView } from './contracts.ts';

const app = await loadPluginApp(() => import('./app.tsx'));
// SAFETY: the collector includes commands at runtime but omits them from CapturedPluginApp's declared Pick.
const command = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions
  .find(row => row.id === 'choose')!;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

const state: StateView = {
  profiles: [
    { name: 'acme-dev', region: 'eu-west-1', status: 'ok' },
    { name: 'acme-prod/ReadOnly', region: null, status: 'sign-in' },
  ],
  error: null,
};

function handlers() {
  let thread: ThreadView = { choice: { profile: null, region: null }, region: null, lastFetch: null };
  return {
    rpc: {
      state: () => state,
      thread: () => thread,
      setChoice: (input: unknown) => {
        const { choice } = input as { choice: ThreadView['choice'] };
        thread = { ...thread, choice, region: choice.region ?? state.profiles.find(p => p.name === choice.profile)?.region ?? null };
        return null;
      },
      signIn: () => ({ ok: true }),
    },
    current: () => thread.choice,
  };
}

it('registers Alt+W in the palette', () => {
  expect(command.defaultShortcut).toMatchObject({ key: 'w', alt: true });
});

it('filters, then picks a profile with Enter', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't1' } as never); });
  const dialog = await overlay.findByRole('dialog', { name: 'AWS profile' });
  await overlay.findByRole('button', { name: /acme-dev/ });
  fireEvent.change(overlay.getByLabelText('Filter profiles'), { target: { value: 'dev' } });
  expect(overlay.queryByRole('button', { name: /Off/ })).toBeNull();
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
});

it('sends a region override and offers sign-in for an expired profile', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't2' } as never); });
  await overlay.findByRole('button', { name: /acme-prod/ });
  fireEvent.change(overlay.getByLabelText('Region override'), { target: { value: 'us-east-1' } });
  fireEvent.click(overlay.getByRole('button', { name: /acme-prod/ }));
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-prod/ReadOnly', region: 'us-east-1' }));
  fireEvent.click(await overlay.findByRole('button', { name: 'Sign in with Granted' }));
  await waitFor(() => expect(overlay.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ profile: 'acme-prod/ReadOnly' }));
  act(() => { void command.run({ threadId: 't2' } as never); });
});

it('rejects a malformed region before calling the server', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't3' } as never); });
  await overlay.findByRole('button', { name: /acme-dev/ });
  fireEvent.change(overlay.getByLabelText('Region override'), { target: { value: 'ireland' } });
  fireEvent.click(overlay.getByRole('button', { name: /acme-dev/ }));
  expect(await overlay.findByRole('alert')).toHaveProperty('textContent', 'ireland is not an AWS region name.');
  expect(overlay.rpcCalls.some(c => c.method === 'setChoice')).toBe(false);
  act(() => { void command.run({ threadId: 't3' } as never); });
});

it('shows a failed load with a retry instead of loading forever', async () => {
  const h = handlers();
  let fail = true;
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { ...h.rpc, state: () => { if (fail) throw new Error('offline'); return state; } } });
  act(() => { void command.run({ threadId: 't4' } as never); });
  expect((await overlay.findByRole('alert')).textContent).toContain('Could not load AWS profiles: offline');
  fail = false;
  fireEvent.click(overlay.getByRole('button', { name: 'Retry' }));
  await overlay.findByRole('button', { name: /acme-dev/ });
  expect(overlay.queryByRole('alert')).toBeNull();
  act(() => { void command.run({ threadId: 't4' } as never); });
});

it('shows a failed sign-in request as an alert', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { ...h.rpc, signIn: () => { throw new Error('host unreachable'); } } });
  act(() => { void command.run({ threadId: 't5' } as never); });
  fireEvent.click(await overlay.findByRole('button', { name: /acme-prod/ }));
  fireEvent.click(await overlay.findByRole('button', { name: 'Sign in with Granted' }));
  expect((await overlay.findByRole('alert')).textContent).toContain('host unreachable');
  act(() => { void command.run({ threadId: 't5' } as never); });
});

it('saves one choice at a time', async () => {
  const h = handlers();
  let finish = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, setChoice: (input: unknown) => new Promise(resolve => { finish = () => resolve(h.rpc.setChoice(input)); }) },
  });
  act(() => { void command.run({ threadId: 't6' } as never); });
  fireEvent.click(await overlay.findByRole('button', { name: /acme-dev/ }));
  await waitFor(() => expect(overlay.getByRole('button', { name: /Off/ })).toHaveProperty('disabled', true));
  fireEvent.click(overlay.getByRole('button', { name: /Off/ }));
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  expect(overlay.rpcCalls.filter(c => c.method === 'setChoice')).toHaveLength(1);
  act(() => finish());
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
});

it('opens on the current choice, so Enter keeps it', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't7' } as never); });
  await overlay.findByRole('button', { name: /acme-dev/ });
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(overlay.rpcCalls.find(c => c.method === 'setChoice')?.input)
    .toEqual({ threadId: 't7', choice: { profile: 'acme-dev', region: null } }));
});
