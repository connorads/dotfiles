// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
let slot: RenderedSlot | undefined;
beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { slot?.lifecycle.unmount(); });
test('visible mark, preview, load and group confirmation controls work without picker keys', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.composerCustomizations[0]!.experimental_popups![0]!, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-test' } },
    rpc: {
      catalogue: () => ({ hostId: 'host-test', canInstall: true, rows: [{ kind: 'folder', ref: 'sample/', count: 1 }, { kind: 'skill', ref: 'sample/design', description: 'Synthetic design skill' }] }),
      preview: () => ({ text: 'Synthetic preview' }),
      install: () => ({ ok: true, output: 'Installed' }),
    },
  });
  fireEvent.click(await slot.findByRole('checkbox', { name: 'Mark sample/' }));
  fireEvent.click(slot.getByRole('button', { name: 'Preview' }));
  await slot.findByText('Synthetic preview');
  fireEvent.click(slot.getByRole('button', { name: /^Install$/ }));
  expect(slot.getByRole('button', { name: 'Install group' })).toBeTruthy();
  fireEvent.click(slot.getByRole('button', { name: /^Cancel$/ }));
  expect(slot.queryByRole('button', { name: 'Install group' })).toBeNull();
  fireEvent.click(slot.getByRole('button', { name: /^Load$/ }));
  await waitFor(() => expect(slot!.inspection.composer.draft.mentions).toHaveLength(1));
  expect(slot.inspection.composer.draft.mentions[0]).toMatchObject({ label: 'sample/' });
});
