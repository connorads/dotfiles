// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
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
      'favourites.move': () => saved,
      'favourites.add': input => { saved = [...saved, { ...input, id: 'new', slot: 2 }]; return saved; },
      'favourites.rename': input => { saved = saved.map(f => f.id === input.id ? { ...f, name: input.name } : f); return saved; },
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
      usage: () => { throw new Error('The picker must not request quota.'); },
      'usage.overview': () => { throw new Error('The picker must not request usage.'); },
      'usage.header': () => { throw new Error('The picker must not request usage.'); },
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
  await waitFor(() => expect(row.hasAttribute('disabled')).toBe(false));
  return row;
}

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

test('an unsupported saved effort disables the row with its reason and keeps the row effort editable', async () => {
  const slot = render([{ ...first, reasoningLevel: 'ultra' }]);
  try {
    await slot.findByText('Saved effort ultra is not available for this model');
    expect(slot.getByRole('button', { name: 'Select model-a' }).hasAttribute('disabled')).toBe(true);
    const effort = slot.getByLabelText('Saved effort for model-a') as HTMLSelectElement;
    expect(effort.hasAttribute('disabled')).toBe(false);
    expect(effort.value).toBe('ultra');
    expect(Array.from(effort.options).map(option => option.textContent)).toEqual(['Default', 'high', 'low', 'ultra (unavailable)']);
    fireEvent.change(effort, { target: { value: 'low' } });
    await waitFor(() => expect(slot.getByRole('button', { name: 'Select model-a' }).hasAttribute('disabled')).toBe(false));
    expect(calls(slot, 'favourites.setEffort').map(call => call.input)).toEqual([{ id: 'a', reasoningLevel: 'low' }]);
  } finally { slot.lifecycle.unmount(); }
});

test('the row effort select saves the effort without changing the composer', async () => {
  const slot = render();
  try {
    await enabledRow(slot, 'Select model-a');
    fireEvent.change(slot.getByLabelText('Saved effort for model-b'), { target: { value: '' } });
    await waitFor(() => expect(calls(slot, 'favourites.setEffort')).toHaveLength(1));
    expect(calls(slot, 'favourites.setEffort')[0]?.input).toEqual({ id: 'b', reasoningLevel: null });
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('catalogue failures explain disabled rows instead of hiding saved favourites', async () => {
  const slot = render([first], 'Sign in required');
  try {
    await slot.findAllByText('Sign in required');
    expect(slot.getByRole('button', { name: 'Select model-a' }).hasAttribute('disabled')).toBe(true);
    expect(slot.inspection.composer.selections).toEqual([]);
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
  expect(app.appOverlays.map(overlay => overlay.id)).toEqual(['picker']);
  const commands = (app as unknown as { commandPaletteActions: { id: string; title: string; defaultShortcut: unknown }[] }).commandPaletteActions;
  const open = commands.find(command => command.id === 'open-picker');
  expect(open?.defaultShortcut).toMatchObject({ key: 'f', alt: true, shift: false });
  expect(open?.title).toBe('Agent Switcher: open picker');
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

test('Claude account switching uses this plugin\'s accounts and choose, and preserves model and draft', async () => {
  const slot = render([], null, {});
  try {
    const accounts = await slot.findByLabelText('Claude account') as HTMLSelectElement;
    expect(accounts.value).toBe('default');
    expect(Array.from(accounts.options).map(option => option.textContent)).toEqual(['Default', 'Work']);
    expect(calls(slot, 'accounts')[0]?.input).toEqual({ threadId: 'thread-test' });
    fireEvent.change(accounts, { target: { value: 'work' } });
    await waitFor(() => expect(accounts.value).toBe('work'));
    expect(calls(slot, 'choose').map(call => call.input)).toEqual([{ threadId: 'thread-test', profileId: 'work' }]);
    expect(slot.inspection.composer.selection?.model).toBe('model-b');
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude account switch failure retains the selected account and reports the refusal', async () => {
  const slot = render([], null, { failSwitch: true });
  try {
    const accounts = await slot.findByLabelText('Claude account') as HTMLSelectElement;
    fireEvent.change(accounts, { target: { value: 'work' } });
    await slot.findByText('Clear queued messages before switching profiles.');
    expect(accounts.value).toBe('default');
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
    const accounts = await slot.findByLabelText('Claude account');
    expect(calls(slot, 'accounts')[0]?.input).toEqual({ threadId: null });
    fireEvent.change(accounts, { target: { value: 'work' } });
    await waitFor(() => expect(calls(slot, 'choose').map(call => call.input)).toEqual([{ threadId: null, profileId: 'work' }]));
    expect(slot.getByText('New Claude threads start on this account.')).toBeTruthy();
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

test('footer effort and tier update the composer without changing favourites or sending', async () => {
  const slot = render();
  try {
    const effort = await slot.findByLabelText('Reasoning effort');
    fireEvent.change(effort, { target: { value: 'high' } });
    await waitFor(() => expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high'));
    fireEvent.change(slot.getByLabelText('Service tier'), { target: { value: 'fast' } });
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
