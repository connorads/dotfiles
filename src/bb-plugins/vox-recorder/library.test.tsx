// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { definePluginApp, useRpc } from '@get-bb/plugin-sdk/app';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';
import { Library } from './library.tsx';
import { setClient } from './vox-store.ts';
import type { rpcContract } from './contracts.ts';
let slot: RenderedSlot | undefined;
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { slot?.lifecycle.unmount(); });
test('visible recording actions rename, cancel and confirm the selected recording', async () => {
  function Surface() { setClient(useRpc<typeof rpcContract>()); return <Library anchor={null} onClose={() => {}} />; }
  const app = await loadPluginApp(async () => definePluginApp(app => { app.slots.experimental_appOverlay({ id: 'library-test', component: Surface }); }));
  const renamed: unknown[] = [];
  slot = renderSlot(app.appOverlays[0]!, {}, { rpc: {
    list: () => [{ name: '2026-01-01-example', title: 'Example', startedAt: 0, bytes: 100, kind: 'solo' }],
    markSeen: () => ({}), preview: () => ({ kind: 'transcript', text: 'Example transcript', truncated: false }),
    rename: (input: unknown) => { renamed.push(input); return { ok: true, path: '/recordings/2026-01-01-example' }; },
  } });
  fireEvent.click(await slot.findByText('Recording actions'));
  fireEvent.click(slot.getByRole('button', { name: /^Rename$/ }));
  fireEvent.change(slot.getByRole('textbox', { name: 'New title' }), { target: { value: 'Updated' } });
  fireEvent.submit(slot.getByRole('textbox', { name: 'New title' }).closest('form')!);
  await waitFor(() => expect(renamed).toEqual([{ name: '2026-01-01-example', title: 'Updated' }]));
  fireEvent.click(slot.getByRole('button', { name: /^Rename$/ }));
  fireEvent.keyDown(slot.getByRole('textbox', { name: 'New title' }), { key: 'Escape' });
  expect(slot.queryByRole('textbox', { name: 'New title' })).toBeNull();
  fireEvent.click(slot.getByRole('button', { name: 'Delete recording' }));
  expect(slot.getByRole('alertdialog').textContent).toContain('2026-01-01-example');
  fireEvent.click(slot.getByRole('button', { name: 'No (n)' }));
  expect(slot.queryByRole('alertdialog')).toBeNull();
  expect(renamed).toHaveLength(1);
});
