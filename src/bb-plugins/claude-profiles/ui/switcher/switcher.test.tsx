// @vitest-environment jsdom
import { beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { Switcher } from './switcher.tsx';
import type { rpcContract } from '../../contracts.ts';
import type { Favourite } from '../../src/models/contract.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
let closed = 0;
function TestSwitcher() {
  const composer = useComposer();
  return <Switcher composer={composer} onClose={() => { closed++; composer.focus(); }} />;
}

const sol: Favourite = { id: 'a', slot: 1, name: '', providerId: 'codex', model: 'sol', reasoningLevel: 'high' };
const opus: Favourite = { id: 'b', slot: 2, name: '', providerId: 'claude-code', model: 'opus', reasoningLevel: 'low' };
const profiles = [
  { id: 'summit', label: 'Summit', configDir: '/p/summit', key: 'S' },
  { id: 'trove', label: 'Trove', configDir: '/p/trove', key: 'T' },
];
const levels = ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort, description: '' }));
const catalogue: Record<string, { name: string; models: string[] }> = {
  codex: { name: 'Codex', models: ['sol', 'luna'] },
  'claude-code': { name: 'Claude Code', models: ['opus', 'haiku'] },
};

type Options = { selection?: Partial<ComposerSelection>; running?: boolean; favourites?: Favourite[]; single?: boolean; connectors?: Record<string, boolean>;
  unsupported?: boolean; newThread?: boolean; daybreak?: boolean };
function render(options: Options = {}) {
  const selection = { providerId: 'claude-code', model: 'opus', reasoningLevel: 'low', environment: { type: 'host' as const, hostId: 'h', workspace: { type: 'personal' as const } }, ...options.selection };
  let saved = options.favourites ?? [sol, opus];
  let currentId = 'summit';
  let pendingId: string | null = null;
  let daybreak = options.daybreak ?? false;
  const slot = renderSlot<Record<string, never>, typeof rpcContract>({ component: TestSwitcher }, {}, {
    composer: { text: 'Keep this draft', isRunning: options.running, selection,
      scope: options.newThread ? { kind: 'new-thread', projectId: null } : { kind: 'thread', threadId: 'thread-test' } },
    rpc: ({
      'favourites.list': () => saved,
      'favourites.add': input => { saved = [...saved, { ...input, id: 'new', slot: 3 }]; return saved; },
      'favourites.remove': input => { saved = saved.filter(f => f.id !== input.id); return saved; },
      'favourites.remember': input => { saved = saved.map(f => f.id === input.id ? { ...f, ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}) } : f); return saved; },
      accounts: () => options.unsupported ? { supported: false, profiles: [], currentId: 'default', pendingId: null }
        : { supported: true, profiles: options.single ? profiles.slice(0, 1) : profiles, currentId, pendingId },
      choose: input => {
        if (options.running) pendingId = input.profileId === currentId ? null : input.profileId;
        else currentId = input.profileId;
        return { currentId };
      },
      'connectors.get': () => ({ enabled: false, launch: 'pending', mode: 'account', accounts: options.connectors ?? {}, profileId: 'summit', restartPending: false }),
      usage: input => ({ status: 'ok', message: null, observedAt: 0, windows: [{ id: 'five_hour', label: 'Five hours', usedPercent: input.profileId === 'trove' ? 92 : 30, resetsAt: null, cost: null }] }),
      nextThreadQuota: () => ({ status: 'ok', message: null, observedAt: 0, windows: [] }),
    } as Partial<PluginRpcTestHandlers<typeof rpcContract>> as PluginRpcTestHandlers<typeof rpcContract>),
    sdk: {
      threads: {
        get: async () => makeThreadResponse({ id: 'thread-test', environmentId: 'env', providerId: selection.providerId }),
        timeline: async () => ({ sessionOptions: selection.providerId === 'codex'
          ? [{ id: 'daybreak', label: 'Daybreak', type: 'boolean', value: daybreak, pendingValue: null, category: null, description: null }] : [] }),
        update: async (input: { sessionOptions?: { daybreak?: boolean } }) => {
          if (typeof input.sessionOptions?.daybreak === 'boolean') daybreak = input.sessionOptions.daybreak;
          return makeThreadResponse({ id: 'thread-test' });
        },
      },
      system: { executionOptions: async ({ providerId = selection.providerId }: { providerId?: string }) => ({
        providers: Object.entries(catalogue).map(([id, value]) => ({ id, available: true, displayName: value.name,
          capabilities: { supportsServiceTier: id === 'codex' } })),
        models: (catalogue[providerId]?.models ?? []).map(model => ({ model, id: model, displayName: model[0]!.toUpperCase() + model.slice(1),
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: levels, ...(providerId === 'codex' ? { supportedServiceTiers: [{ id: 'fast', label: 'Fast' }], sessionOptions: [{ id: 'daybreak', label: 'Daybreak', type: 'boolean', value: false }] } : {}) })),
        modelLoadError: null,
      }) },
    } as never,
  });
  return slot;
}
const calls = (slot: ReturnType<typeof render>, method: string) => slot.inspection.rpcCalls.filter(call => call.method === method).map(call => call.input);
const dialog = (slot: ReturnType<typeof render>) => slot.getByRole('dialog', { name: 'Switch model' });

test('favourites list in slot order with the current one checked, and a digit applies a favourite without sending', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: '2. Opus' });
    expect(slot.getByRole('button', { name: '2. Opus' }).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(dialog(slot), { key: '1' });
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('sol'));
    expect(slot.inspection.composer.selection?.reasoningLevel).toBe('high');
    expect(slot.inspection.composer.submits).toEqual([]);
    expect(slot.inspection.composer.text).toBe('Keep this draft');
  } finally { slot.lifecycle.unmount(); }
});

test('an account letter switches the Claude account and the account row shows each letter', async () => {
  const slot = render();
  try {
    const trove = await slot.findByRole('button', { name: 'Trove' });
    expect(trove.getAttribute('aria-keyshortcuts')).toBe('T');
    fireEvent.keyDown(dialog(slot), { key: 't' });
    await waitFor(() => expect(calls(slot, 'choose')).toEqual([{ threadId: 'thread-test', profileId: 'trove' }]));
    await waitFor(() => expect(slot.getByRole('button', { name: 'Trove' }).getAttribute('aria-pressed')).toBe('true'));
  } finally { slot.lifecycle.unmount(); }
});

test('mid-turn the chosen account is marked for the next turn', async () => {
  const slot = render({ running: true });
  try {
    await slot.findByRole('button', { name: 'Trove' });
    fireEvent.keyDown(dialog(slot), { key: 'T' });
    await slot.findByRole('button', { name: 'Trove, next turn' });
  } finally { slot.lifecycle.unmount(); }
});

test('the account row is hidden for a model without accounts and for a single account', async () => {
  const codex = render({ selection: { providerId: 'codex', model: 'sol', reasoningLevel: 'high' } });
  try {
    await codex.findByRole('button', { name: '1. Sol' });
    expect(codex.queryByRole('group', { name: 'Claude account' })).toBeNull();
    expect(calls(codex, 'accounts')).toEqual([]);
  } finally { codex.lifecycle.unmount(); }
  const single = render({ single: true });
  try {
    await single.findByRole('button', { name: '2. Opus' });
    await waitFor(() => expect(calls(single, 'accounts')).toHaveLength(1));
    expect(single.queryByRole('group', { name: 'Claude account' })).toBeNull();
  } finally { single.lifecycle.unmount(); }
});

test('connectors and quota show on the account row', async () => {
  const slot = render({ connectors: { trove: true } });
  try {
    await slot.findByRole('button', { name: 'Trove, connectors on' });
    await waitFor(() => expect(slot.container.querySelector('[data-account="trove"]')?.closest('.sw-ring')?.getAttribute('data-tone')).toBe('critical'));
  } finally { slot.lifecycle.unmount(); }
});

test('left and right change effort and the current favourite remembers it', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: '2. Opus' });
    fireEvent.keyDown(dialog(slot), { key: 'ArrowRight' });
    await waitFor(() => expect(slot.inspection.composer.selection?.reasoningLevel).toBe('medium'));
    await waitFor(() => expect(calls(slot, 'favourites.remember')).toEqual([{ id: 'b', reasoningLevel: 'medium' }]));
  } finally { slot.lifecycle.unmount(); }
});

test('a current model that is not a favourite leads the list and Cmd+S keeps it with its effort', async () => {
  const slot = render({ selection: { providerId: 'claude-code', model: 'haiku', reasoningLevel: 'high' } });
  try {
    await slot.findByText('⌘S to keep');
    fireEvent.keyDown(dialog(slot), { key: 's', metaKey: true });
    await waitFor(() => expect(calls(slot, 'favourites.add')).toEqual([{ name: '', providerId: 'claude-code', model: 'haiku', reasoningLevel: 'high' }]));
    await slot.findByRole('button', { name: '3. Haiku' });
  } finally { slot.lifecycle.unmount(); }
});

test('slash opens search across providers; Enter uses the highlighted model and Escape returns', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: '2. Opus' });
    fireEvent.keyDown(dialog(slot), { key: '/' });
    const input = await slot.findByRole('textbox', { name: 'Search models' });
    fireEvent.change(input, { target: { value: 'lun' } });
    await slot.findByRole('button', { name: 'Luna' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(slot.inspection.composer.selection?.model).toBe('luna'));
    await slot.findByRole('button', { name: /Luna/ });
    fireEvent.keyDown(dialog(slot), { key: '/' });
    fireEvent.keyDown(await slot.findByRole('textbox', { name: 'Search models' }), { key: 'Escape' });
    await slot.findByRole('button', { name: 'All models' });
  } finally { slot.lifecycle.unmount(); }
});

test('Cmd+S in search stars the highlighted model', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: '2. Opus' });
    fireEvent.keyDown(dialog(slot), { key: '/' });
    const input = await slot.findByRole('textbox', { name: 'Search models' });
    fireEvent.change(input, { target: { value: 'haiku' } });
    await slot.findByRole('button', { name: 'Haiku' });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    await waitFor(() => expect(calls(slot, 'favourites.add')).toEqual([{ name: '', providerId: 'claude-code', model: 'haiku' }]));
  } finally { slot.lifecycle.unmount(); }
});

test('Fast shows only for a model with a fast tier and is remembered by its favourite', async () => {
  const slot = render({ selection: { providerId: 'codex', model: 'sol', reasoningLevel: 'high' } });
  try {
    const fast = await slot.findByRole('button', { name: 'Fast' });
    fireEvent.click(fast);
    await waitFor(() => expect(slot.inspection.composer.selection?.serviceTier).toBe('fast'));
    await waitFor(() => expect(calls(slot, 'favourites.remember')).toEqual([{ id: 'a', serviceTier: 'fast' }]));
  } finally { slot.lifecycle.unmount(); }
  const claude = render();
  try {
    await claude.findByRole('button', { name: '2. Opus' });
    expect(claude.queryByRole('button', { name: 'Fast' })).toBeNull();
  } finally { claude.lifecycle.unmount(); }
});

test('Escape and Enter close the switcher', async () => {
  const slot = render();
  try {
    await slot.findByRole('button', { name: '2. Opus' });
    const before = closed;
    fireEvent.keyDown(dialog(slot), { key: 'Escape' });
    fireEvent.keyDown(dialog(slot), { key: 'Enter' });
    expect(closed - before).toBe(2);
  } finally { slot.lifecycle.unmount(); }
});

test('a handoff without account choice says when accounts become available', async () => {
  const slot = render({ unsupported: true });
  try {
    await slot.findByText(/Account choice opens after the first message/);
    expect(calls(slot, 'choose')).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('a Daybreak choice is its own favourite beside the standard model', async () => {
  const slot = render({ selection: { providerId: 'codex', model: 'sol', reasoningLevel: 'high' }, daybreak: true });
  try {
    await slot.findByText('⌘S to keep');
    expect(slot.getByRole('button', { name: 'Sol · Daybreak' })).toBeTruthy();
    fireEvent.keyDown(dialog(slot), { key: 's', metaKey: true });
    await waitFor(() => expect(calls(slot, 'favourites.add')).toEqual([{ name: '', providerId: 'codex', model: 'sol', daybreak: true, reasoningLevel: 'high' }]));
    await slot.findByRole('button', { name: '3. Sol · Daybreak' });
    expect(slot.getByRole('button', { name: '1. Sol' })).toBeTruthy();
    fireEvent.keyDown(dialog(slot), { key: '1' });
    await waitFor(() => expect(slot.getByRole('button', { name: '1. Sol' }).getAttribute('aria-current')).toBe('true'));
    fireEvent.keyDown(dialog(slot), { key: '3' });
    await waitFor(() => expect(slot.getByRole('button', { name: '3. Sol · Daybreak' }).getAttribute('aria-current')).toBe('true'));
  } finally { slot.lifecycle.unmount(); }
});

test('search lists Daybreak variants that can be starred directly', async () => {
  const slot = render({ selection: { providerId: 'codex', model: 'sol', reasoningLevel: 'high' } });
  try {
    await slot.findByRole('button', { name: '1. Sol' });
    fireEvent.keyDown(dialog(slot), { key: '/' });
    const input = await slot.findByRole('textbox', { name: 'Search models' });
    fireEvent.change(input, { target: { value: 'luna daybreak' } });
    fireEvent.change(input, { target: { value: 'daybreak' } });
    fireEvent.click(await slot.findByRole('button', { name: 'Favourite Luna · Daybreak' }));
    await waitFor(() => expect(calls(slot, 'favourites.add')).toEqual([{ name: '', providerId: 'codex', model: 'luna', daybreak: true }]));
  } finally { slot.lifecycle.unmount(); }
});
