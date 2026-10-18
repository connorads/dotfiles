// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers, RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { close, openedState } from './ui/picker/store.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { close(); cleanup(); });

const profiles = [
  { id: 'default', label: 'Default', configDir: null },
  { id: 'work', label: 'work', configDir: '/profiles/work' },
];
const newThread = { scope: { kind: 'new-thread' as const, projectId: 'project-test' },
  selection: { providerId: 'claude-code', environment: { type: 'host' as const, hostId: 'host-test', workspace: { type: 'personal' as const } } } };
const thread = { scope: { kind: 'thread' as const, threadId: 'thread-test' }, selection: { providerId: 'claude-code' } };
type Composer = NonNullable<RenderSlotOptions<typeof rpcContract>['composer']>;

// Renders every composer action and the picker overlay together, as BB shows them.
async function render(composer: Composer, rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const actions = app.composerCustomizations.flatMap(customization => customization.actions ?? []);
  const overlay = app.appOverlays.find(registration => registration.id === 'picker');
  if (!overlay) throw new Error('Missing picker overlay.');
  const Picker = overlay.component;
  const commands = (app as unknown as { commandPaletteActions: { id: string; title: string; defaultShortcut: unknown;
    run: (context: { composer: ReturnType<typeof useComposer> }) => void }[] }).commandPaletteActions;
  const switcher = commands.find(command => command.id === 'open-switcher');
  function Surface() {
    const api = useComposer();
    return <>
      {actions.map(action => <action.component key={action.id} />)}
      <button type="button" data-testid="run-switcher" onClick={() => switcher?.run({ composer: api })} />
      <Picker />
    </>;
  }
  let currentId = 'default';
  // Methods without a handler reject, which keeps the usage RPCs out of this surface.
  const slot = renderSlot<object, typeof rpcContract>({ component: Surface }, {}, { composer, rpc: {
    accounts: () => ({ supported: true, profiles, currentId }),
    choose: input => { currentId = input.profileId; return { currentId }; },
    'favourites.list': () => [],
    usage: () => ({ status: 'unavailable', windows: [], message: null, observedAt: null }),
    ...rpc,
  } as PluginRpcTestHandlers<typeof rpcContract> });
  return { slot, app, switcher };
}

test('the status shows the remembered account in a new-thread Claude composer', async () => {
  const { slot } = await render(newThread, { accounts: () => ({ supported: true, profiles, currentId: 'work' }) });
  expect((await slot.findByRole('button', { name: /Claude account/ })).textContent).toBe('work');
  expect(slot.inspection.rpcCalls.find(call => call.method === 'accounts')?.input).toEqual({ threadId: null });
});

test('the status hides when the new-thread composer selects another provider', async () => {
  const { slot } = await render({ ...newThread, selection: { ...newThread.selection, providerId: 'codex' } });
  expect(slot.inspection.rpcCalls.some(call => call.method === 'accounts')).toBe(false);
  expect(slot.queryByRole('button', { name: /Claude account/ })).toBeNull();
});

test('clicking the status opens the account picker with the current account focused', async () => {
  const { slot } = await render(thread);
  expect(slot.queryByRole('dialog', { name: 'Switch Claude account' })).toBeNull();
  fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
  await slot.findByRole('dialog', { name: 'Switch Claude account' });
  await waitFor(() => expect(document.activeElement).toBe(slot.getByRole('button', { name: 'Switch to Default' })));
});

test('Alt+A opens the account picker with account focus', async () => {
  const { slot, switcher } = await render(thread);
  expect(switcher?.title).toBe('Switch Claude account');
  expect(switcher?.defaultShortcut).toMatchObject({ key: 'a', alt: true });
  fireEvent.click(slot.getByTestId('run-switcher'));
  await waitFor(() => expect(document.activeElement).toBe(slot.getByRole('button', { name: 'Switch to Default' })));
});

test('the composer customisation registers no popups', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.composerCustomizations.flatMap(customization => customization.experimental_popups ?? [])).toEqual([]);
});

test('account digits switch the account through the registered overlay', async () => {
  const { slot } = await render(thread);
  fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
  const dialog = await slot.findByRole('dialog', { name: 'Switch Claude account' });
  await slot.findByRole('button', { name: 'Switch to work' });
  expect(within(dialog).getAllByRole('button', { name: /^Switch to/ })).toHaveLength(2);
  fireEvent.keyDown(dialog, { key: '2' });
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose').map(call => call.input))
    .toEqual([{ threadId: 'thread-test', profileId: 'work' }]));
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
});

test('Alt+A in a queued editor cannot change the new-thread account', async () => {
  const { slot } = await render({ scope: { kind: 'queued-message', threadId: 'thread-test', queuedMessageId: 'queue-test' },
    selection: { providerId: 'claude-code' } });
  fireEvent.click(slot.getByTestId('run-switcher'));
  expect(openedState()).toBeNull();
  expect(slot.queryByRole('dialog', { name: 'Switch Claude account' })).toBeNull();
  expect(slot.queryByRole('button', { name: /Claude account/ })).toBeNull();
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'accounts' || call.method === 'choose')).toEqual([]);
});

test('a Claude handoff explains account limits without changing the source or remembered account', async () => {
  const { slot } = await render(thread, {
    accounts: () => ({ supported: false, profiles: [], currentId: 'default' }),
  });
  fireEvent.click(slot.getByTestId('run-switcher'));
  await slot.findByText(/New Claude threads use your remembered account/);
  expect(slot.queryByRole('alert')).toBeNull();
  expect(slot.queryByRole('button', { name: /^Switch to/ })).toBeNull();
  expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
  expect(slot.inspection.composer.submits).toEqual([]);
});


test('the model picker explains the same Claude handoff limitation', async () => {
  const { slot } = await render(thread, {
    accounts: () => ({ supported: false, profiles: [], currentId: 'default' }),
  });
  fireEvent.click(slot.getByRole('button', { name: 'Switch model' }));
  await slot.findByText(/New Claude threads use your remembered account/);
  expect(slot.inspection.rpcCalls.some(call => call.method === 'choose')).toBe(false);
});

test('the badge bridge loads thread accounts and reloads when an account changes', async () => {
  const { getBadges } = await import('./ui/badges/store.ts');
  const app = await loadPluginApp(() => import('./app.tsx'));
  const bridge = app.appOverlays.find(registration => registration.id === 'account-badges');
  if (!bridge) throw new Error('Missing badge bridge.');
  let label = 'Team Beta';
  const slot = renderSlot<object, typeof rpcContract>({ component: bridge.component }, {}, { rpc: {
    threadAccounts: () => [{ threadId: 't1', profileId: 'Team Beta', label }],
  } as Partial<PluginRpcTestHandlers<typeof rpcContract>> as PluginRpcTestHandlers<typeof rpcContract> });
  await waitFor(() => expect(getBadges().get('t1')?.label).toBe('Team Beta'));
  label = 'Team Alpha';
  await slot.behavior.emitRealtime('profiles-changed', { threadId: 't1' });
  await waitFor(() => expect(getBadges().get('t1')?.label).toBe('Team Alpha'));
  expect(app.contentScripts.map(script => script.id)).toContain('account-badges');
});
