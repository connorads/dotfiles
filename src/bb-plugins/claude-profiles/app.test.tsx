// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers, RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { close, openedState } from './ui/switcher/store.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { close(); cleanup(); });

const profiles = [
  { id: 'default', label: 'Default', configDir: null, key: 'D' },
  { id: 'work', label: 'Work', configDir: '/profiles/work', key: 'W' },
];
const newThread = { scope: { kind: 'new-thread' as const, projectId: 'project-test' },
  selection: { providerId: 'claude-code', model: 'opus', reasoningLevel: 'high', environment: { type: 'host' as const, hostId: 'host-test', workspace: { type: 'personal' as const } } } };
const thread = { scope: { kind: 'thread' as const, threadId: 'thread-test' }, selection: { providerId: 'claude-code', model: 'opus', reasoningLevel: 'high' } };
type Composer = NonNullable<RenderSlotOptions<typeof rpcContract>['composer']>;

// Renders every composer action and the picker overlay together, as BB shows them.
async function render(composer: Composer, rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const actions = app.composerCustomizations.flatMap(customization => customization.actions ?? []);
  const overlay = app.appOverlays.find(registration => registration.id === 'switcher');
  if (!overlay) throw new Error('Missing switcher overlay.');
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
    accounts: () => ({ supported: true, profiles, currentId, pendingId: null }),
    'connectors.get': () => ({ enabled: false, launch: 'pending', mode: 'account', accounts: {}, profileId: 'default', restartPending: false }),
    choose: input => { currentId = input.profileId; return { currentId }; },
    'favourites.list': () => [],
    usage: () => ({ status: 'unavailable', windows: [], message: null, observedAt: null }),
    ...rpc,
  } as PluginRpcTestHandlers<typeof rpcContract> });
  return { slot, app, switcher };
}

test('the chip shows the model, effort and the remembered account in a new-thread Claude composer', async () => {
  const { slot } = await render(newThread, { accounts: () => ({ supported: true, profiles, currentId: 'work', pendingId: null }) });
  const chip = await slot.findByRole('button', { name: /^Switch model: opus, high, Work account/ });
  expect(chip.textContent).toContain('Work');
  expect(slot.inspection.rpcCalls.find(call => call.method === 'accounts')?.input).toEqual({ threadId: null });
});

test('the chip leaves out the account for another provider', async () => {
  const { slot } = await render({ ...newThread, selection: { ...newThread.selection, providerId: 'codex', model: 'sol' } });
  await slot.findByRole('button', { name: /^Switch model: sol/ });
  expect(slot.inspection.rpcCalls.some(call => call.method === 'accounts')).toBe(false);
});

test('clicking the chip opens the switcher', async () => {
  const { slot } = await render(thread);
  expect(slot.queryByRole('dialog', { name: 'Switch model' })).toBeNull();
  fireEvent.click(await slot.findByRole('button', { name: /^Switch model:/ }));
  await slot.findByRole('dialog', { name: 'Switch model' });
});

test('one switcher command and nine favourite shortcuts replace the old pickers', async () => {
  const { slot, app, switcher } = await render(thread);
  expect(switcher?.title).toBe('Switch model');
  expect(switcher?.defaultShortcut).toMatchObject({ key: 'm', mod: true, shift: true });
  const commands = (app as unknown as { commandPaletteActions: { id: string; defaultShortcut?: { key: string; alt?: boolean } }[] }).commandPaletteActions;
  expect(commands.filter(command => command.id.startsWith('select-favourite-')).map(command => ({ key: command.defaultShortcut?.key, alt: command.defaultShortcut?.alt })))
    .toEqual(Array.from({ length: 9 }, (_, index) => ({ key: String(index + 1), alt: true })));
  expect(commands.some(command => command.id === 'open-picker' || command.id === 'next-favourite')).toBe(false);
  fireEvent.click(slot.getByTestId('run-switcher'));
  await slot.findByRole('dialog', { name: 'Switch model' });
});

test('the switcher does not open in a queued editor', async () => {
  const { slot } = await render({ scope: { kind: 'queued-message', threadId: 'thread-test', queuedMessageId: 'queue-test' },
    selection: { providerId: 'claude-code' } });
  fireEvent.click(slot.getByTestId('run-switcher'));
  expect(openedState()).toBeNull();
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose')).toEqual([]);
});

test('connector preferences live in the plugin settings', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect((app as unknown as { settingsSections: { id: string }[] }).settingsSections.map(section => section.id)).toEqual(['connectors']);
});

test('the composer customisation registers no popups', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.composerCustomizations.flatMap(customization => customization.experimental_popups ?? [])).toEqual([]);
});

test('the badge bridge loads thread accounts and reloads when an account changes', async () => {
  const { getBadges } = await import('./ui/badges/store.ts');
  const app = await loadPluginApp(() => import('./app.tsx'));
  const bridge = app.appOverlays.find(registration => registration.id === 'account-badges');
  if (!bridge) throw new Error('Missing badge bridge.');
  let label = 'beta';
  const slot = renderSlot<object, typeof rpcContract>({ component: bridge.component }, {}, { rpc: {
    threadAccounts: () => [{ threadId: 't1', profileId: 'beta', label, key: null }],
  } as Partial<PluginRpcTestHandlers<typeof rpcContract>> as PluginRpcTestHandlers<typeof rpcContract> });
  await waitFor(() => expect(getBadges().get('t1')?.label).toBe('beta'));
  label = 'alpha';
  await slot.behavior.emitRealtime('profiles-changed', { threadId: 't1' });
  await waitFor(() => expect(getBadges().get('t1')?.label).toBe('alpha'));
  expect(app.contentScripts.map(script => script.id)).toContain('account-badges');
});
