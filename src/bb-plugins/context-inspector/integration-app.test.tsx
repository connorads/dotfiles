// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { InspectorPopup } from './app';
import { createFakeSdk } from '@get-bb/plugin-sdk/testing';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialised'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const usage = (usedTokens: number) => ({ usage: { usedTokens, modelContextWindow: 1000, estimated: false } });
function setup(firstContext?: Promise<ReturnType<typeof usage>>, anchored = false) {
  let contextReads = 0;
  const { sdk } = createFakeSdk({ pluginId: 'context-inspector', overrides: {
      threads: { get: ({ threadId }) => ({ id: threadId, environmentId: 'environment-synthetic' }),
        context: ({ threadId }) => {
          contextReads++;
          return threadId === 'thread-first' && firstContext && contextReads === 1 ? firstContext : usage(222);
        } },
      environments: { get: () => ({ hostId: 'host-synthetic' }) },
      plugins: { list: async () => ({ plugins: [{ id: 'synthetic-owner', enabled: true, capabilities: [
        { kind: 'agent-tool', id: 'synthetic-tool', label: 'Synthetic tool', detail: 'Do not display this body.' },
        { kind: 'skill', id: 'synthetic-skill', label: 'Synthetic skill', detail: null },
      ] }] }), getSettings: () => ({ schema: { introduction: { type: 'boolean' } }, values: { introduction: true } }) },
    },
  });
  return renderSlot({ component: anchored ? () => <div data-promptbox-typeahead-menu="" style={{ position: 'absolute', bottom: 200 }}><InspectorPopup /></div> : InspectorPopup }, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-first' }, text: 'Synthetic draft' },
    rpc: { owner: () => ({ kind: 'unavailable', reason: 'Synthetic remote owner unavailable.' }) },
    sdk: {
      threads: { get: args => sdk.threads.get(args), context: args => sdk.threads.context(args) },
      environments: { get: args => sdk.environments.get(args) },
      plugins: { list: args => sdk.plugins.list(args), getSettings: args => sdk.plugins.getSettings(args) },
    },
  });
}
test('late context response from another target never replaces the selected thread', async () => {
  const pending = deferred<ReturnType<typeof usage>>();
  const slot = setup(pending.promise);
  await slot.setComposerScope({ kind: 'thread', threadId: 'thread-second' });
  await slot.findByText('thread-second');
  await slot.findByText(/222 \/ 1,000 tokens/);
  await act(async () => { pending.resolve(usage(111)); await pending.promise; });
  expect(slot.queryByText(/111 \/ 1,000 tokens/)).toBeNull();
  expect(slot.getByText('thread-second')).toBeTruthy();
  expect(slot.composer.draft.text).toBe('Synthetic draft');
});
test('current inventory stays separate and an unavailable owner cannot be previewed', async () => {
  const slot = setup();
  await slot.findByText('thread-first');
  fireEvent.click(slot.getByRole('button', { name: /Sources/ }));
  expect(slot.getByText('synthetic-owner')).toBeTruthy();
  expect(slot.getByText(/Synthetic tool/)).toBeTruthy();
  expect(slot.getByText(/Synthetic skill/)).toBeTruthy();
  expect(slot.queryByText('Do not display this body.')).toBeNull();
  fireEvent.click(slot.getByRole('button', { name: 'Configure' }));
  expect(slot.getByRole('alert').textContent).toBe('Synthetic remote owner unavailable.');
  expect(slot.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
  expect(slot.queryByRole('button', { name: 'Export private patch' })).toBeNull();
  expect(slot.getByText('Saved').textContent).toContain('On');
});
test('refresh discards an older response for the same thread', async () => {
  const pending = deferred<ReturnType<typeof usage>>();
  const slot = setup(pending.promise);
  // Wait until the first context request is outstanding.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(slot.getByRole('button', { name: 'Refresh recorded data' }));
  await slot.findByText(/222 \/ 1,000 tokens/);
  await act(async () => { pending.resolve(usage(111)); await pending.promise; });
  expect(slot.queryByText(/111 \/ 1,000 tokens/)).toBeNull();
});
test('leaving the thread clears pending reads and removes the previous target', async () => {
  const slot = setup();
  await slot.findByText('thread-first');
  await slot.setComposerScope({ kind: 'new-thread', projectId: null });
  expect(slot.getByText('Select an existing thread.')).toBeTruthy();
  expect(slot.queryByText('thread-first')).toBeNull();
});
test('registers a thread-only popup and plus menu without an extra composer button', async () => {
  const app = await loadPluginApp(() => import('./app'));
  expect(app.composerCustomizations).toHaveLength(1);
  const registration = app.composerCustomizations[0];
  expect(registration?.scopes).toEqual(['thread']);
  expect(registration?.experimental_popups?.map(popup => popup.id)).toEqual(['context']);
  expect(registration?.actions ?? []).toHaveLength(0);
  expect(registration?.plusMenu?.map(item => item.label)).toEqual(['Inspect context']);
  expect(app.navPanels.map(panel => panel.id)).toEqual(['fixtures']);
});

test('caps an anchored popup at the space above the composer and responds to resizing', async () => {
  let bottom = 240;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ bottom, top: 0, left: 0, right: 725, width: 725, height: bottom, x: 0, y: 0, toJSON: () => ({}) }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const slot = setup(undefined, true);
  await slot.findByText('thread-first');
  const popup = slot.getByRole('region', { name: 'Context inspector' }).parentElement;
  expect(popup?.style.getPropertyValue('--ci-max-height')).toBe('228px');
  bottom = 180;
  fireEvent(window, new Event('resize'));
  expect(popup?.style.getPropertyValue('--ci-max-height')).toBe('168px');
});
