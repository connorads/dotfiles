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

const rows = [
  { kind: 'folder', ref: 'sample/', source: 'sample', count: 2 },
  { kind: 'skill', ref: 'sample/design', source: 'sample', name: 'design', description: 'Synthetic design skill' },
  { kind: 'skill', ref: 'sample/review', source: 'sample', name: 'review', description: 'Synthetic review skill' },
];

test('a failed catalogue says so and Retry or Enter loads it again', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  let calls = 0;
  slot = renderSlot(app.composerCustomizations[0]!.experimental_popups![0]!, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-test' } },
    rpc: {
      catalogue: () => {
        calls += 1;
        if (calls < 3) throw new Error('skl not found');
        return { hostId: 'host-test', canInstall: true, rows };
      },
    },
  });
  await slot.findByText('skl not found');
  const filter = slot.getByRole('textbox', { name: 'Filter skills' });
  expect(filter.getAttribute('placeholder')).toBe('skl catalogue unavailable');
  fireEvent.click(slot.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(calls).toBe(2));
  await slot.findByText('skl not found');
  fireEvent.keyDown(filter, { key: 'Enter' });
  await slot.findByRole('checkbox', { name: 'Mark sample/design' });
  expect(calls).toBe(3);
  expect(slot.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(slot.inspection.composer.draft.mentions).toHaveLength(0);
});

test('marks hidden by the filter are counted next to the marks', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.composerCustomizations[0]!.experimental_popups![0]!, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-test' } },
    rpc: { catalogue: () => ({ hostId: 'host-test', canInstall: true, rows }) },
  });
  fireEvent.click(await slot.findByRole('checkbox', { name: 'Mark sample/design' }));
  fireEvent.click(slot.getByRole('checkbox', { name: 'Mark sample/review' }));
  expect(slot.getByText('2 marked')).toBeTruthy();
  fireEvent.change(slot.getByRole('textbox', { name: 'Filter skills' }), { target: { value: 'review' } });
  expect(slot.getByText('2 marked, 1 hidden')).toBeTruthy();
});

test('a failed preview shows as an error, not as skill text', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.composerCustomizations[0]!.experimental_popups![0]!, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-test' } },
    rpc: {
      catalogue: () => ({ hostId: 'host-test', canInstall: true, rows }),
      preview: () => { throw new Error('preview failed'); },
    },
  });
  await slot.findByRole('checkbox', { name: 'Mark sample/' });
  fireEvent.click(slot.getByRole('button', { name: 'Preview' }));
  const alert = await slot.findByRole('alert');
  expect(alert.textContent).toBe('preview failed');
});

test('a new copy attempt clears the previous error', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  let calls = 0;
  slot = renderSlot(app.composerCustomizations[0]!.experimental_popups![0]!, {}, {
    composer: { scope: { kind: 'thread', threadId: 'thread-test' } },
    rpc: {
      catalogue: () => ({ hostId: 'host-test', canInstall: true, rows }),
      pointers: () => {
        calls += 1;
        if (calls === 1) throw new Error('pointers failed');
        return new Promise(() => {});
      },
    },
  });
  await slot.findByRole('checkbox', { name: 'Mark sample/' });
  fireEvent.click(slot.getByRole('button', { name: 'Copy' }));
  await slot.findByText('pointers failed');
  fireEvent.click(slot.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(calls).toBe(2));
  expect(slot.queryByText('pointers failed')).toBeNull();
});
