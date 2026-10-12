// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers, RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { close } from './ui/picker/store.ts';

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
    usage: () => { throw new Error('The switcher must not request quota.'); },
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
  await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'accounts')).toBe(true));
  expect(slot.queryByRole('button', { name: /Claude account/ })).toBeNull();
});

test('clicking the status opens the picker with the account select focused', async () => {
  const { slot } = await render(thread);
  expect(slot.queryByRole('dialog', { name: 'Switch model' })).toBeNull();
  fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
  await slot.findByRole('dialog', { name: 'Switch model' });
  await waitFor(() => expect(document.activeElement).toBe(slot.getByLabelText('Claude account')));
});

test('the switch account command opens the picker with account focus and has no shortcut', async () => {
  const { slot, switcher } = await render(thread);
  expect(switcher?.title).toBe('Agent Switcher: switch account');
  expect(switcher?.defaultShortcut).toBeNull();
  fireEvent.click(slot.getByTestId('run-switcher'));
  await waitFor(() => expect(document.activeElement).toBe(slot.getByLabelText('Claude account')));
});

test('the composer customisation registers no popups', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.composerCustomizations.flatMap(customization => customization.experimental_popups ?? [])).toEqual([]);
});

test('exactly one control in the composer and picker can change the account', async () => {
  const { slot } = await render(thread);
  fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
  await slot.findByLabelText('Claude account');
  expect(slot.queryAllByRole('menuitemradio')).toEqual([]);
  expect(slot.getAllByRole('combobox', { name: 'Claude account' })).toHaveLength(1);
  // Pressing an account digit in the picker must not switch the account.
  fireEvent.keyDown(slot.getByRole('dialog', { name: 'Switch model' }), { key: '2' });
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose')).toEqual([]);
  fireEvent.change(slot.getByLabelText('Claude account'), { target: { value: 'work' } });
  await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === 'choose').map(call => call.input))
    .toEqual([{ threadId: 'thread-test', profileId: 'work' }]));
});
