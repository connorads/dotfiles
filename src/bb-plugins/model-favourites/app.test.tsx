// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { ModelPicker } from './app.tsx';
import { useComposer } from '@get-bb/plugin-sdk/app';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
function TestPicker() {
  const composer = useComposer();
  return <ModelPicker composer={composer} onClose={() => composer.focus()} />;
}
import type { Favourite, rpcContract } from './contracts.ts';

const first: Favourite = { id: 'a', slot: 1, name: 'Deep', providerId: 'codex', model: 'model-a', reasoningLevel: 'high' };
const second: Favourite = { ...first, id: 'b', slot: 3, name: 'Quick', model: 'model-b', reasoningLevel: 'low' };
function render(initial = [first, second], error: string | null = null, account?: { running?: boolean; failSwitch?: boolean; missing?: boolean; newThread?: boolean }) {
  const providerId = account ? 'claude-code' : 'codex';
  let profileId: string | null = null;
  let saved = initial;
  return renderSlot<Record<string, never>, typeof rpcContract>({ component: TestPicker }, {}, {
    composer: { text: 'Do not send this draft', isRunning: account?.running, selection: { providerId, model: 'model-b', reasoningLevel: 'low', environment: { type: 'host', hostId: 'host-test', workspace: { type: 'personal' } } }, scope: account && !account.newThread ? { kind: 'thread', threadId: 'thread-test' } : { kind: 'new-thread', projectId: null } },
    rpc: {
      list: () => saved,
      move: () => saved,
      add: input => { saved = [...saved, { ...input, id: 'new', slot: 2 }]; return saved; },
      rename: input => { saved = saved.map(f => f.id === input.id ? { ...f, name: input.name } : f); return saved; },
      remove: input => { saved = saved.filter(f => f.id !== input.id); return saved; },
    },
    sdk: {
      plugins: { callRpc: async args => {
        if (account?.missing) throw new Error('Claude Profiles is disabled');
        if (args.method === 'choose') {
          if (account?.failSwitch) throw new Error('Clear queued messages before switching profiles.');
          profileId = 'work';
          return args.outputSchema.parse({ currentId: 'work' });
        }
        return args.outputSchema.parse({ supported: true, profiles: [{ id: 'default', label: 'Default' }, { id: 'work', label: 'Work' }],
          currentId: profileId ?? 'default' });
      } },
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
    }) } },
  });
}

test('one click applies a saved favourite without sending or replacing the draft', async () => {
  const slot = render();
  try {
    const row = await slot.findByRole('button', { name: 'Select model-a' });
    await waitFor(() => expect(row.hasAttribute('disabled')).toBe(false));
    fireEvent.click(row);
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
    expect(slot.inspection.composer.selection?.reasoningLevel).toBe('low');
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
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
    const star = await slot.findByRole('button', { name: 'Favourite model-a' });
    await waitFor(() => expect(star.hasAttribute('disabled')).toBe(false));
    fireEvent.click(star);
    await slot.findAllByRole('button', { name: 'Unfavourite model-a' });
    const call = slot.inspection.rpcCalls.find(c => c.method === 'add');
    expect(call?.input).toEqual({ name: '', providerId: 'codex', model: 'model-a' });
    expect(slot.inspection.composer.selections).toEqual([]);
    expect(slot.inspection.composer.submits).toEqual([]);
    const stars = slot.getAllByRole('button', { name: 'Unfavourite model-a' });
    fireEvent.click(stars[0]!);
    await slot.findByRole('button', { name: 'Favourite model-a' });
  } finally { slot.lifecycle.unmount(); }
});

test('empty focused search selects a saved slot and preserves the draft', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: 'Select model-a' });
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

test('registers one overlay for both supported composer scopes', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  expect(app.composerCustomizations[0]?.scopes).toEqual(['thread', 'new-thread']);
  expect(app.appOverlays[0]?.id).toBe('model-picker');
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
    await slot.findByRole('button', { name: 'Select model-a' });
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
    const row = await slot.findByRole('button', { name: 'Select model-a' });
    fireEvent.keyDown(slot.getByLabelText('Search models'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: '1' });
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
  } finally { slot.lifecycle.unmount(); }
});

test('Claude account switching uses the profile backend and preserves model and draft', async () => {
  const slot = render([], null, {});
  try {
    const accounts = await slot.findByLabelText('Claude account');
    expect((accounts as HTMLSelectElement).value).toBe('');
    fireEvent.change(accounts, { target: { value: 'work' } });
    await waitFor(() => expect((accounts as HTMLSelectElement).value).toBe('work'));
    const calls = slot.inspection.sdkCalls.filter(call => call.method === 'plugins.callRpc');
    expect(calls.some(call => JSON.stringify(call.args).includes('"profileId":"work"'))).toBe(true);
    expect(slot.inspection.composer.selection?.model).toBe('model-b');
    expect(slot.inspection.composer.text).toBe('Do not send this draft');
    expect(slot.inspection.composer.submits).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude account switch failure retains the selected account and reports the refusal', async () => {
  const slot = render([], null, { failSwitch: true });
  try {
    const accounts = await slot.findByLabelText('Claude account');
    fireEvent.change(accounts, { target: { value: 'work' } });
    await slot.findByText('Clear queued messages before switching profiles.');
    expect((accounts as HTMLSelectElement).value).toBe('');
  } finally { slot.lifecycle.unmount(); }
});

test('running Claude chats disable account switching', async () => {
  const slot = render([], null, { running: true });
  try {
    const accounts = await slot.findByLabelText('Claude account');
    expect(accounts.hasAttribute('disabled')).toBe(true);
    expect(slot.getByText('Available when this turn finishes.')).toBeTruthy();
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'plugins.callRpc')).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); }
});

test('new Claude drafts explain account availability without calling the account backend', async () => {
  const slot = render([], null, { newThread: true });
  try {
    await slot.findByText('Choose an account after the first message.');
    expect(slot.inspection.sdkCalls.filter(call => call.method === 'plugins.callRpc')).toHaveLength(0);
  } finally { slot.lifecycle.unmount(); }
});

test('missing account plugin does not prevent selecting models', async () => {
  const slot = render([], null, { missing: true });
  try {
    await slot.findByText('Claude Profiles is disabled');
    const row = await slot.findByRole('button', { name: 'Select model-a' });
    await waitFor(() => expect(row.hasAttribute('disabled')).toBe(false));
    fireEvent.click(row);
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('model-a'));
  } finally { slot.lifecycle.unmount(); }
});


test('effort and tier update BB selection without changing favourites or sending', async () => {
  const slot = render();
  try {
    const effort = await slot.findByLabelText('Reasoning effort');
    fireEvent.change(effort, { target: { value: 'high' } });
    await waitFor(() => expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high'));
    fireEvent.change(slot.getByLabelText('Service tier'), { target: { value: 'fast' } });
    await waitFor(() => expect(slot.inspection.composer.selection?.serviceTier).toBe('fast'));
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'add')).toEqual([]);
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
