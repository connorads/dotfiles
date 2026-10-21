// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { ComposerSelection } from '@get-bb/plugin-sdk/app';
import { Trigger } from './trigger.tsx';
import { close, openedState } from './store.ts';
import type { rpcContract } from '../../contracts.ts';
import type { Favourite } from '../../src/models/contract.ts';

afterEach(() => close());

const host = { type: 'host' as const, hostId: 'host-test', workspace: { type: 'personal' as const } };
const opus: Favourite = { id: 'opus', slot: 1, name: '', providerId: 'claude-code', model: 'opus', reasoningLevel: 'high' };
const filler = (slot: number): Favourite => ({ id: `f${slot}`, slot, name: '', providerId: 'codex', model: `m${slot}` });

// Renders the trigger beside a button that changes the composer's model, as BB's own model picker would.
function render(initial: Favourite[], selection: Partial<ComposerSelection> = { providerId: 'claude-code', model: 'opus', reasoningLevel: 'medium' }) {
  let saved = initial;
  function Surface() {
    const composer = useComposer();
    return <>
      <Trigger />
      <button type="button" data-testid="pick-sonnet" onClick={() => { void composer.setSelection({ providerId: 'claude-code', model: 'sonnet' }); }} />
    </>;
  }
  const slot = renderSlot<object, typeof rpcContract>({ component: Surface }, {}, {
    composer: { scope: { kind: 'new-thread', projectId: null }, selection: { environment: host, ...selection } },
    rpc: {
      'favourites.list': () => saved,
      'favourites.add': input => { saved = [...saved, { ...input, id: 'new', slot: 2 }]; return saved; },
      'favourites.remove': input => { saved = saved.filter(f => f.id !== input.id); return saved; },
    } as Partial<PluginRpcTestHandlers<typeof rpcContract>> as PluginRpcTestHandlers<typeof rpcContract>,
    sdk: { system: { executionOptions: async () => ({
      providers: [], permissionCeiling: 'auto', selectedOnlyModels: [], modelLoadError: null,
      models: [{ model: 'opus', id: 'opus', displayName: 'Opus 5.5', description: '', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] },
        { model: 'sonnet', id: 'sonnet', displayName: 'Sonnet 5', description: '', isDefault: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }],
    }) } },
  });
  return { slot, setSaved: (list: Favourite[]) => { saved = list; } };
}
const calls = (slot: ReturnType<typeof renderSlot>, method: string) => slot.inspection.rpcCalls.filter(call => call.method === method);
const star = (slot: ReturnType<typeof renderSlot>) => slot.getByRole('button', { name: /^Favourite / });

test('the star adds the current model with its current effort, then reads as a favourite', async () => {
  const { slot } = render([]);
  try {
    await waitFor(() => expect(star(slot).title).toBe('Add Opus 5.5 · Medium to favourites'));
    expect(star(slot).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(star(slot));
    await waitFor(() => expect(star(slot).getAttribute('aria-pressed')).toBe('true'));
    expect(calls(slot, 'favourites.add').map(call => call.input))
      .toEqual([{ name: '', providerId: 'claude-code', model: 'opus', reasoningLevel: 'medium' }]);
    expect(star(slot).title).toBe('Remove Opus 5.5 from favourites');
    expect(slot.inspection.composer.selections).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('the star removes the current model when it is already a favourite', async () => {
  const { slot } = render([opus]);
  try {
    await waitFor(() => expect(star(slot).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(star(slot));
    await waitFor(() => expect(star(slot).getAttribute('aria-pressed')).toBe('false'));
    expect(calls(slot, 'favourites.remove').map(call => call.input)).toEqual([{ id: 'opus' }]);
  } finally { slot.lifecycle.unmount(); }
});

test('the star follows composer selection changes and favourites changed elsewhere', async () => {
  const { slot, setSaved } = render([opus]);
  try {
    await waitFor(() => expect(star(slot).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(slot.getByTestId('pick-sonnet'));
    await waitFor(() => expect(star(slot).title).toBe('Add Sonnet 5 · Medium to favourites'));
    expect(star(slot).getAttribute('aria-pressed')).toBe('false');
    setSaved([opus, { ...opus, id: 'sonnet', slot: 2, model: 'sonnet' }]);
    await slot.behavior.emitRealtime('favourites-changed', {});
    await waitFor(() => expect(star(slot).getAttribute('aria-pressed')).toBe('true'));
  } finally { slot.lifecycle.unmount(); }
});

test('the star is disabled without a model', async () => {
  const { slot } = render([], { providerId: 'claude-code' });
  try {
    await waitFor(() => expect(calls(slot, 'favourites.list')).not.toHaveLength(0));
    expect(slot.getByRole('button', { name: 'Favourite current model' }).hasAttribute('disabled')).toBe(true);
  } finally { slot.lifecycle.unmount(); }
});

test('nine favourites block another and the title explains why', async () => {
  const { slot } = render(Array.from({ length: 9 }, (_, index) => filler(index + 1)));
  try {
    await waitFor(() => expect(star(slot).title).toBe('Nine favourites saved. Remove one to add Opus 5.5.'));
    expect(star(slot).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(star(slot));
    expect(calls(slot, 'favourites.add')).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});

test('the chevron opens the picker on this composer', async () => {
  const { slot } = render([]);
  try {
    const open = slot.getByRole('button', { name: 'Switch model' });
    expect(open.title).toBe('Switch model (⌥F)');
    fireEvent.click(open);
    expect(openedState()).toEqual({ key: slot.inspection.composer.key, focus: 'search' });
  } finally { slot.lifecycle.unmount(); }
});


test('a Codex draft explains why its unknown Daybreak setting cannot be saved', async () => {
  const { slot } = render([], { providerId: 'codex', model: 'model-a' });
  try {
    const star = await slot.findByRole('button', { name: 'Favourite model-a' });
    expect(star.getAttribute('aria-disabled')).toBe('true');
    expect(star.title).toContain('after starting a thread');
    fireEvent.click(star);
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'favourites.add')).toEqual([]);
  } finally { slot.lifecycle.unmount(); }
});
