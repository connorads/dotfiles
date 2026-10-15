// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { ModelPicker } from './picker.tsx';
import type { rpcContract } from '../../contracts.ts';
import type { Favourite } from '../../src/models/contract.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
function TestPicker() {
  const composer = useComposer();
  return <ModelPicker composer={composer} onClose={() => composer.focus()} />;
}

const first: Favourite = { id: 'a', slot: 1, name: 'Deep', providerId: 'codex', model: 'model-a', reasoningLevel: 'high' };
const second: Favourite = { ...first, id: 'b', slot: 3, name: 'Quick', model: 'model-b', reasoningLevel: 'low' };
const profiles = [{ id: 'default', label: 'Default', configDir: null }, { id: 'work', label: 'Work', configDir: '/profiles/work' }];
type Account = { running?: boolean; failSwitch?: boolean; missing?: boolean; newThread?: boolean; queued?: boolean };
const accountCalls: string[] = [];
function render(initial = [first, second], error: string | null = null, account?: Account, selection: Partial<ComposerSelection> = {}) {
  const providerId = account ? 'claude-code' : 'codex';
  let currentId = 'default';
  let saved = initial;
  return renderSlot<Record<string, never>, typeof rpcContract>({ component: TestPicker }, {}, {
    composer: { text: 'Do not send this draft', isRunning: account?.running,
      selection: { providerId, model: 'model-b', reasoningLevel: 'low', environment: { type: 'host', hostId: 'host-test', workspace: { type: 'personal' } }, ...selection },
      scope: account?.queued ? { kind: 'queued-message', threadId: 'thread-test', queuedMessageId: 'queued-test' }
        : account && !account.newThread ? { kind: 'thread', threadId: 'thread-test' } : { kind: 'new-thread', projectId: null } },
    rpc: {
      'favourites.list': () => saved,
      'favourites.add': input => { saved = [...saved, { ...input, id: 'new', slot: 2 }]; return saved; },
      'favourites.remove': input => { saved = saved.filter(f => f.id !== input.id); return saved; },
      'favourites.setEffort': input => {
        saved = saved.map(f => {
          if (f.id !== input.id) return f;
          const { reasoningLevel: _, ...rest } = f;
          return input.reasoningLevel ? { ...rest, reasoningLevel: input.reasoningLevel } : rest;
        });
        return saved;
      },
      accounts: () => {
        accountCalls.push('accounts');
        if (account?.missing) throw new Error('Could not list Claude accounts');
        return { supported: true, profiles, currentId };
      },
      choose: input => {
        accountCalls.push('choose');
        if (account?.failSwitch) throw new Error('Clear queued messages before switching profiles.');
        currentId = input.profileId;
        return { currentId };
      },
      nextThreadQuota: input => input.profileId === 'work'
        ? { status: 'ok', message: null, observedAt: 0, windows: [{ id: 'five_hour', label: 'Five hours', usedPercent: 40, resetsAt: null, cost: null }] }
        : { status: 'error', message: 'unavailable', observedAt: null, windows: [] },
      usage: input => input.profileId === 'work'
        ? { status: 'ok', message: null, observedAt: 0, windows: [
          { id: 'five_hour', label: 'Five hours', usedPercent: 12.4, resetsAt: null, cost: null },
          { id: 'seven_day', label: 'Seven days', usedPercent: 30, resetsAt: null, cost: null }] }
        : { status: 'ok', message: 'No limits reported', observedAt: null, windows: [] },
      'usage.header': () => { throw new Error('The picker must not request usage.'); },
      'usage.amp': () => { throw new Error('Unused Amp usage'); },
      'usage.inspection': () => { throw new Error('The picker must not request usage.'); },
    },
    sdk: {
      threads: { get: async () => ({
        id: 'thread-test', providerId, environmentId: 'environment-test', projectId: 'project-test', status: 'idle',
        runtime: { displayStatus: 'idle' }, activeBackgroundAgentCount: 0, queuedMessageCount: 0,
        archivedAt: null, deletedAt: null, lastReadAt: null, lifecycleOwnerThreadId: null, originKind: null, originPluginId: null,
        parentThreadId: null, pinnedAt: null, sectionId: null, sourceThreadId: null, title: null, titleFallback: null,
        visibility: 'visible', createdAt: 0, updatedAt: 0, latestAttentionAt: 0, canRestoreEnvironment: false, canSpawnChild: true,
      }) },
      system: { executionOptions: async () => ({
        providers: [{ id: providerId, available: true, displayName: account ? 'Claude Code' : 'Codex', pluginId: 'codex', logoUrl: null,
          completedTurnDisplay: 'collapse', composerActions: [], maintenance: { health: false, installation: false, usage: false },
          capabilities: { modelCatalogScope: 'host', permissionModes: ['auto'], supportsFork: false,
            supportsNativeUserQuestion: false, supportsServiceTier: true, supportsSessionRewind: false,
            supportsThreadArchive: false, supportsThreadRename: false },
        }], permissionCeiling: 'auto', selectedOnlyModels: [],
        modelLoadError: error ? { detail: error, code: 'failed', providerId: 'codex' } : null,
        models: [first, second].map(f => ({ model: f.model, id: f.model, displayName: f.model, description: '', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }, { reasoningEffort: 'low', description: '' }], supportedServiceTiers: [{ id: 'fast', label: 'Fast' }] })),
      }) },
    },
  });
}
const calls = (slot: ReturnType<typeof render>, method: string) => slot.inspection.rpcCalls.filter(call => call.method === method);
async function enabledRow(slot: ReturnType<typeof render>, name: string) {
  const row = await slot.findByRole('button', { name });
  await waitFor(() => expect(row.getAttribute('aria-disabled')).toBeNull());
  return row;
}
const disabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true';
// Opens a saved effort pill's listbox and returns it.
function effortMenu(slot: ReturnType<typeof render>, model: string) {
  fireEvent.click(slot.getByRole('button', { name: new RegExp(`^Saved effort for ${model}:`) }));
  return slot.getByRole('listbox', { name: `Saved effort for ${model}` });
}
const optionNames = (listbox: HTMLElement) => within(listbox).getAllByRole('option').map(option => option.textContent);

test('one click applies a saved favourite with its saved effort, without sending or replacing the draft', async () => {
  const slot = render();
  try {
    fireEvent.click(await enabledRow(slot, 'Select model-a'));
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
    expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high');
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
  } finally { slot.lifecycle.unmount(); }
});

test('a favourite without saved effort applies the model default, not the composer effort', async () => {
  const { reasoningLevel: _, ...plain } = first;
  const slot = render([plain]);
  try {
    expect(slot.inspection.composer.selection?.reasoningLevel).toBe('low');
    fireEvent.click(await enabledRow(slot, 'Select model-a'));
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
    expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high');
  } finally { slot.lifecycle.unmount(); }
});

test('an unsupported saved effort disables the row with its reason and keeps the saved effort editable', async () => {
  const slot = render([{ ...first, reasoningLevel: 'ultra' }]);
  try {
    await slot.findByText('Saved effort ultra is not available for this model');
    const row = slot.getByRole('button', { name: 'Select model-a' });
    expect(disabled(row)).toBe(true);
    fireEvent.click(row);
    expect(slot.inspection.composer.selections).toEqual([]);
    const pill = slot.getByRole('button', { name: 'Saved effort for model-a: Ultra (unavailable)' });
    expect(pill.hasAttribute('disabled')).toBe(false);
    const menu = effortMenu(slot, 'model-a');
    expect(optionNames(menu)).toEqual(['DefaultHigh', 'High', 'Low', 'Ultra (unavailable)']);
    expect(within(menu).getByRole('option', { selected: true }).textContent).toBe('Ultra (unavailable)');
    fireEvent.click(within(menu).getByRole('option', { name: 'Low' }));
    await waitFor(() => expect(disabled(slot.getByRole('button', { name: 'Select model-a' }))).toBe(false));
    expect(calls(slot, 'favourites.setEffort').map(call => call.input)).toEqual([{ id: 'a', reasoningLevel: 'low' }]);
  } finally { slot.lifecycle.unmount(); }
});

test('the saved effort pill saves the effort without changing the composer', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    expect(slot.getByRole('button', { name: 'Saved effort for model-b: Low' })).toBeTruthy();
    fireEvent.click(within(effortMenu(slot, 'model-b')).getByRole('option', { name: /^Default/ }));
    await waitFor(() => expect(calls(slot, 'favourites.setEffort')).toHaveLength(1));
    expect(calls(slot, 'favourites.setEffort')[0]?.input).toEqual({ id: 'b', reasoningLevel: null });
    await slot.findByRole('button', { name: 'Saved effort for model-b: Default' });
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('the effort listbox works by keyboard and Escape closes it before the picker', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    const menu = effortMenu(slot, 'model-a');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('High'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Low'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(slot.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(slot.getByRole('button', { name: /^Saved effort for model-a:/ }));
    expect(menu.isConnected).toBe(false);
    fireEvent(slot.getByRole('dialog', { name: 'Switch model' }), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(slot.inspection.composer.focusCount).toBe(1);
    effortMenu(slot, 'model-a');
    fireEvent(slot.getByRole('dialog', { name: 'Switch model' }), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(slot.queryByRole('listbox')).toBeNull();
    expect(slot.inspection.composer.focusCount).toBe(1);
    expect(calls(slot, 'favourites.setEffort')).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('left and right arrows on a favourite row step its saved effort through Default and the model efforts', async () => {
  const slot = render();
  try {
    const row = await enabledRow(slot, 'Select model-b');
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    await waitFor(() => expect(calls(slot, 'favourites.setEffort').map(call => call.input)).toEqual([{ id: 'b', reasoningLevel: 'high' }]));
    await slot.findByRole('button', { name: 'Saved effort for model-b: High' });
    await enabledRow(slot, 'Select model-b');
    fireEvent.keyDown(slot.getByRole('button', { name: 'Select model-b' }), { key: 'ArrowLeft' });
    await slot.findByRole('button', { name: 'Saved effort for model-b: Default' });
    await enabledRow(slot, 'Select model-b');
    fireEvent.keyDown(slot.getByRole('button', { name: 'Select model-b' }), { key: 'ArrowLeft' });
    expect(calls(slot, 'favourites.setEffort')).toHaveLength(2);
    fireEvent.keyDown(slot.getByRole('button', { name: 'Select model-b' }), { key: 'ArrowRight' });
    await slot.findByRole('button', { name: 'Saved effort for model-b: High' });
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('Cmd+S or Ctrl+S toggles the focused row favourite and blocks the browser save', async () => {
  const slot = render([first]);
  try {
    const row = await enabledRow(slot, 'Select model-b');
    expect(fireEvent.keyDown(row, { key: 's', metaKey: true })).toBe(false);
    await slot.findByRole('button', { name: 'Unfavourite model-b' });
    expect(calls(slot, 'favourites.add').map(call => call.input)).toEqual([{ name: '', providerId: 'codex', model: 'model-b' }]);
    await enabledRow(slot, 'Select model-a');
    expect(fireEvent.keyDown(slot.getByRole('button', { name: 'Select model-a' }), { key: 's', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(calls(slot, 'favourites.remove').map(call => call.input)).toEqual([{ id: 'a' }]));
    expect(fireEvent.keyDown(slot.getByLabelText('Search models'), { key: 's', metaKey: true })).toBe(false);
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('favourite rows show their slot and the selected row is marked current', async () => {
  const slot = render();
  try {
    const row = await enabledRow(slot, 'Select model-b');
    expect(row.querySelector('kbd')?.textContent).toBe('3');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(slot.getByRole('button', { name: 'Select model-a' }).getAttribute('aria-current')).toBeNull();
    expect(within(slot.getByRole('group', { name: 'Filter models' })).getAllByRole('button').map(chip => chip.textContent))
      .toEqual(['All', 'Favourites2', 'Codex']);
    expect(slot.queryByLabelText('Claude account')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('opening centres the selected model so rows on both sides stay visible, and leaves focus in search', async () => {
  const scrolled: Element[] = [];
  const options: unknown[] = [];
  // jsdom has no scrollIntoView, so the test installs one and removes it afterwards.
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value(this: Element, option: unknown) { scrolled.push(this); options.push(option); } });
  const slot = render([first]);
  try {
    const row = await enabledRow(slot, 'Select model-b');
    await waitFor(() => expect(scrolled.some(element => element.contains(row))).toBe(true));
    expect(scrolled).toHaveLength(1);
    expect(options).toEqual([{ block: 'center' }]);
    expect(document.activeElement).toBe(slot.getByRole('textbox'));
  } finally { slot.lifecycle.unmount(); Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); }
});

test('catalogue failures explain disabled rows instead of hiding saved favourites', async () => {
  const slot = render([first], 'Sign in required');
  try {
    await slot.findAllByText('Sign in required');
    expect(disabled(slot.getByRole('button', { name: 'Select model-a' }))).toBe(true);
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('a failed provider catalogue shows one compact muted row and drops out of searches that miss its name', async () => {
  const slot = render([], 'spawn cursor-agent ENOENT');
  try {
    const section = await slot.findByRole('region', { name: 'Codex' });
    const note = within(section).getByText('Not available on this machine');
    expect(note.getAttribute('title')).toBe('spawn cursor-agent ENOENT');
    expect(note.className).toBe('mf-unavailable');
    fireEvent.change(slot.getByLabelText('Search models'), { target: { value: 'opus' } });
    expect(slot.queryByRole('region', { name: 'Codex' })).toBeNull();
    expect(slot.getByText('No models found.')).toBeTruthy();
    fireEvent.change(slot.getByLabelText('Search models'), { target: { value: 'cod' } });
    expect(slot.getByRole('region', { name: 'Codex' })).toBeTruthy();
    expect(slot.queryByText('No models found.')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('stars a model directly without selecting it or sending the draft', async () => {
  const slot = render([]);
  try {
    fireEvent.click(await enabledRow(slot, 'Favourite model-a'));
    await slot.findAllByRole('button', { name: 'Unfavourite model-a' });
    expect(calls(slot, 'favourites.add')[0]?.input).toEqual({ name: '', providerId: 'codex', model: 'model-a' });
    expect(slot.inspection.composer.selections).toEqual([]);
    expect(slot.inspection.composer.submits).toEqual([]);
    fireEvent.click(slot.getAllByRole('button', { name: 'Unfavourite model-a' })[0]!);
    await slot.findByRole('button', { name: 'Favourite model-a' });
  } finally { slot.lifecycle.unmount(); }
});

test('empty focused search selects a saved slot and preserves the draft', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    const search = slot.getByLabelText('Search models');
    expect(document.activeElement).toBe(search);
    expect(fireEvent.keyDown(search, { key: '1' })).toBe(false);
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
  } finally { slot.lifecycle.unmount(); }
});

test('empty slots, modified digits and composing input remain search input', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: 'Select model-a' });
    const search = slot.getByLabelText('Search models');
    for (const key of [{ key: '2' }, { key: '1', ctrlKey: true }, { key: '1', altKey: true }, { key: '1', metaKey: true }, { key: '1', isComposing: true }]) {
      expect(fireEvent.keyDown(search, key)).toBe(true);
    }
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('search filters models and typing a slot number does not switch selection', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: 'Select model-a' });
    const search = slot.getByLabelText('Search models');
    fireEvent.change(search, { target: { value: 'model-a' } });
    expect(fireEvent.keyDown(search, { key: '1' })).toBe(true);
    expect(slot.inspection.composer.selections).toEqual([]);
    expect(slot.queryByRole('button', { name: 'Select model-b' })).toBeNull();
    expect(slot.getAllByRole('button', { name: 'Select model-a' })).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'nonexistent' } });
    expect(slot.getByText('No models found.')).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('registers one picker overlay for both composer scopes and Alt+F opens it', async () => {
  const app = await loadPluginApp(() => import('../../app.tsx'));
  expect(app.composerCustomizations.find(c => c.id === 'agent-switcher')?.scopes).toEqual(['thread', 'new-thread']);
  expect(app.appOverlays.filter(overlay => overlay.id === 'picker')).toHaveLength(1);
  const commands = (app as unknown as { commandPaletteActions: { id: string; title: string; defaultShortcut: unknown }[] }).commandPaletteActions;
  const open = commands.find(command => command.id === 'open-picker');
  expect(open?.defaultShortcut).toMatchObject({ key: 'f', alt: true, shift: false });
  expect(open?.title).toBe('Open model picker');
  expect(commands.find(command => command.id === 'next-favourite')?.defaultShortcut).toMatchObject({ key: 'f', alt: true, shift: true });
});

test('favourites filter shows one row per starred model and supports an empty list', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: 'Select model-a' });
    fireEvent.click(slot.getByRole('button', { name: /Favourites/ }));
    expect(slot.getAllByRole('button', { name: 'Select model-a' })).toHaveLength(1);
    expect(slot.getAllByRole('button', { name: 'Select model-b' })).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); }
  const empty = render([]);
  try {
    await empty.findByRole('button', { name: 'Select model-a' });
    fireEvent.click(empty.getByRole('button', { name: /Favourites/ }));
    expect(empty.getByText('Star a model to keep it here.')).toBeTruthy();
  } finally { empty.lifecycle.unmount(); }
});

test('search Enter selects the first matching model without sending the prompt', async () => {
  const slot = render([]);
  try {
    await enabledRow(slot, 'Select model-a');
    const search = slot.getByLabelText('Search models');
    fireEvent.change(search, { target: { value: 'model-a' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('arrow keys move from search to models and a slot number selects its favourite', async () => {
  const slot = render();
  try {
    const row = await enabledRow(slot, 'Select model-a');
    fireEvent.keyDown(slot.getByLabelText('Search models'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: '1' });
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
  } finally { slot.lifecycle.unmount(); }
});

// Opens the account menu and returns its listbox.
function accountMenu(slot: ReturnType<typeof render>) {
  fireEvent.click(slot.getByLabelText('Claude account'));
  return slot.getByRole('listbox', { name: 'Claude accounts' });
}

test('Claude account switching uses this plugin\'s accounts and choose, and preserves model and draft', async () => {
  const slot = render([], null, {});
  try {
    const button = await slot.findByLabelText('Claude account');
    expect(button.textContent).toBe('Default');
    expect(calls(slot, 'accounts')[0]?.input).toEqual({ threadId: 'thread-test' });
    const menu = accountMenu(slot);
    expect(within(menu).getAllByRole('option').map(option => option.querySelector('.mf-option-label')?.textContent)).toEqual(['Default', 'Work']);
    expect(within(menu).getByRole('option', { selected: true }).textContent).toContain('Default');
    fireEvent.click(within(menu).getByRole('option', { name: /^Work/ }));
    await waitFor(() => expect(button.textContent).toBe('Work'));
    expect(calls(slot, 'choose').map(call => call.input)).toEqual([{ threadId: 'thread-test', profileId: 'work' }]);
    expect(slot.inspection.composer.selection?.model).toBe('model-b');
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('the account menu shows each account\'s cached quota once it opens', async () => {
  const slot = render([], null, {});
  try {
    await slot.findByLabelText('Claude account');
    expect(calls(slot, 'usage')).toEqual([]);
    const menu = accountMenu(slot);
    await waitFor(() => expect(within(menu).getByRole('option', { name: /^Work/ }).textContent).toBe('Work5h 12% · 7d 30%'));
    expect(within(menu).getByRole('option', { name: /^Default/ }).textContent).toBe('Default');
    expect(calls(slot, 'usage').map(call => call.input)).toEqual([
      { threadId: 'thread-test', profileId: 'default', refresh: false }, { threadId: 'thread-test', profileId: 'work', refresh: false }]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    accountMenu(slot);
    expect(calls(slot, 'usage')).toHaveLength(2);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude account switch failure retains the selected account and reports the refusal', async () => {
  const slot = render([], null, { failSwitch: true });
  try {
    const button = await slot.findByLabelText('Claude account');
    fireEvent.click(within(accountMenu(slot)).getByRole('option', { name: /^Work/ }));
    await slot.findByText('Clear queued messages before switching profiles.');
    expect(button.textContent).toBe('Default');
  } finally { slot.lifecycle.unmount(); }
});

test('running Claude chats disable account switching', async () => {
  const slot = render([], null, { running: true });
  try {
    const accounts = await slot.findByLabelText('Claude account');
    expect(accounts.hasAttribute('disabled')).toBe(true);
    expect(slot.getByText('Available when this turn finishes.')).toBeTruthy();
    expect(calls(slot, 'choose')).toHaveLength(0);
  } finally { slot.lifecycle.unmount(); }
});

test('the new-thread composer lists accounts and remembers the choice for the next thread', async () => {
  const slot = render([], null, { newThread: true });
  try {
    await slot.findByLabelText('Claude account');
    expect(calls(slot, 'accounts')[0]?.input).toEqual({ threadId: null });
    fireEvent.click(within(accountMenu(slot)).getByRole('option', { name: /^Work/ }));
    await waitFor(() => expect(calls(slot, 'choose').map(call => call.input)).toEqual([{ threadId: null, profileId: 'work' }]));
    expect(slot.getByText('New Claude threads start on this account.')).toBeTruthy();
    expect(calls(slot, 'usage')).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('an account failure does not prevent selecting models', async () => {
  const slot = render([], null, { missing: true });
  try {
    await slot.findByText('Could not list Claude accounts');
    fireEvent.click(await enabledRow(slot, 'Select model-a'));
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
  } finally { slot.lifecycle.unmount(); }
});

test('the current effort and tier controls update the composer without changing favourites or sending', async () => {
  const slot = render();
  try {
    const effort = await slot.findByRole('radiogroup', { name: 'Reasoning effort' });
    expect(within(effort).getByRole('radio', { checked: true }).textContent).toBe('Low');
    fireEvent.click(within(effort).getByRole('radio', { name: 'High' }));
    await waitFor(() => expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high'));
    fireEvent.keyDown(within(effort).getByRole('radio', { name: 'High' }), { key: 'ArrowRight' });
    await waitFor(() => expect(slot.inspection.composer.selection?.reasoningLevel).toBe('low'));
    const tier = slot.getByRole('radiogroup', { name: 'Service tier' });
    fireEvent.click(within(tier).getByRole('radio', { name: 'Fast' }));
    await waitFor(() => expect(slot.inspection.composer.selection?.serviceTier).toBe('fast'));
    expect(calls(slot, 'favourites.add')).toEqual([]);
    expect(calls(slot, 'favourites.setEffort')).toEqual([]);
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('Escape requests closure and restores composer focus', async () => {
  const slot = render([]);
  try {
    await slot.findByRole('button', { name: 'Select model-a' });
    fireEvent(slot.getByRole('dialog', { name: 'Switch model' }), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
  } finally { slot.lifecycle.unmount(); }
});

test.each(['q', 'Q'])('%s types in search and closes from a model row', async key => {
  const slot = render([]);
  try {
    const row = await slot.findByRole('button', { name: 'Select model-a' });
    const input = slot.getByRole('textbox');
    fireEvent.keyDown(input, { key });
    expect(slot.inspection.composer.focusCount).toBe(0);
    fireEvent.keyDown(row, { key, ctrlKey: true });
    expect(slot.inspection.composer.focusCount).toBe(0);
    fireEvent.keyDown(row, { key });
    expect(slot.inspection.composer.focusCount).toBe(1);
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('a queued-message editor shows no account control and never changes the account', async () => {
  accountCalls.length = 0;
  const slot = render([first, second], null, { queued: true });
  try {
    await slot.findByLabelText('Search models');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(slot.queryByLabelText('Claude account')).toBeNull();
    expect(accountCalls).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('rows name their provider only where the section heading does not', async () => {
  const slot = render([first]);
  try {
    const favourite = await enabledRow(slot, 'Select model-a');
    expect(favourite.textContent).toBe('1model-aCodex');
    expect(slot.getByRole('button', { name: 'Select model-b' }).textContent).toBe('model-b');
    fireEvent.change(slot.getByLabelText('Search models'), { target: { value: 'model' } });
    expect(slot.getByRole('button', { name: 'Select model-b' }).textContent).toBe('model-bCodex');
  } finally { slot.lifecycle.unmount(); }
});

test('effort glyphs keep Default aligned and tell levels above high apart', async () => {
  const slot = render([{ ...first, reasoningLevel: 'ultra' }, { ...second, reasoningLevel: 'xhigh' }]);
  try {
    await slot.findByRole('button', { name: 'Saved effort for model-a: Ultra (unavailable)' });
    const bars = (element: Element | null | undefined) => element?.querySelectorAll('.mf-glyph rect[data-on]').length;
    const menu = effortMenu(slot, 'model-a');
    const option = (name: RegExp) => within(menu).getByRole('option', { name });
    expect(option(/^Default/).querySelector('.mf-glyph')).not.toBeNull();
    expect([bars(option(/^Default/)), bars(option(/^Low/)), bars(option(/^High/))]).toEqual([0, 1, 3]);
    const xhigh = slot.getByRole('button', { name: 'Saved effort for model-b: Extra High (unavailable)' });
    const ultra = slot.getByRole('button', { name: 'Saved effort for model-a: Ultra (unavailable)' });
    expect(bars(xhigh)).toBe(4);
    expect(bars(ultra)).toBe(4);
    expect(xhigh.querySelector('.mf-glyph')?.getAttribute('data-peak')).toBeNull();
    expect(ultra.querySelector('.mf-glyph')?.getAttribute('data-peak')).toBe('true');
  } finally { slot.lifecycle.unmount(); }
});

test('the Claude account refresh button uses an icon BB provides', async () => {
  const slot = render([], null, {});
  try {
    const refresh = await slot.findByRole('button', { name: 'Refresh Claude accounts' });
    expect(refresh.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('ArrowReloadHorizontal');
  } finally { slot.lifecycle.unmount(); }
});

test('the provider chip strip fades whichever edge hides chips', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    const strip = slot.getByRole('group', { name: 'Filter models' });
    Object.defineProperties(strip, { clientWidth: { value: 200 }, scrollWidth: { value: 400 }, scrollLeft: { value: 0, writable: true } });
    fireEvent.scroll(strip);
    expect([strip.hasAttribute('data-more-start'), strip.hasAttribute('data-more-end')]).toEqual([false, true]);
    strip.scrollLeft = 100; fireEvent.scroll(strip);
    expect([strip.hasAttribute('data-more-start'), strip.hasAttribute('data-more-end')]).toEqual([true, true]);
    strip.scrollLeft = 200; fireEvent.scroll(strip);
    expect([strip.hasAttribute('data-more-start'), strip.hasAttribute('data-more-end')]).toEqual([true, false]);
  } finally { slot.lifecycle.unmount(); }
});

test('while searching, the row Enter will choose is marked', async () => {
  const slot = render([]);
  try {
    await enabledRow(slot, 'Select model-a');
    expect(slot.container.querySelector('[data-enter-target]')).toBeNull();
    fireEvent.change(slot.getByLabelText('Search models'), { target: { value: 'model-b' } });
    await waitFor(() => expect(slot.container.querySelector('[data-enter-target] [aria-label="Select model-b"]')).not.toBeNull());
    expect(slot.container.querySelectorAll('[data-enter-target]')).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); }
});

test('a provider chip returns focus to search so typing keeps filtering', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    const chip = slot.getByRole('button', { name: /^All/ });
    chip.focus();
    fireEvent.click(chip);
    expect(document.activeElement).toBe(slot.getByLabelText('Search models'));
  } finally { slot.lifecycle.unmount(); }
});

test('a new-thread draft\'s account menu shows quota for this machine', async () => {
  const slot = render([], null, { newThread: true });
  try {
    await slot.findByLabelText('Claude account');
    const menu = accountMenu(slot);
    await waitFor(() => expect(within(menu).getByRole('option', { name: /^Work/ }).textContent).toBe('Work5h 40%'));
    expect(calls(slot, 'usage')).toEqual([]);
    expect(calls(slot, 'nextThreadQuota').map(call => call.input)).toEqual([{ profileId: 'default' }, { profileId: 'work' }]);
  } finally { slot.lifecycle.unmount(); }
});
