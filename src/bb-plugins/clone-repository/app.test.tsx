// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers, type RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import { useComposer } from '@get-bb/plugin-sdk/app';
import type { PluginCommandRegistration, PluginSidebarProject } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const atlas = { fullName: 'acme/atlas', description: 'Synthetic application', visibility: 'private' };
const compass = { fullName: 'acme/compass', description: 'Synthetic library', visibility: 'public' };
type Options = RenderSlotOptions<typeof rpcContract>;
async function render(options: { composer?: Options['composer']; rpc?: Partial<PluginRpcTestHandlers<typeof rpcContract>>; projects?: PluginSidebarProject[] } = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const overlay = app.appOverlays[0];
  const menu = app.composerCustomizations[0]?.plusMenu?.[0];
  if (!overlay || !menu) throw new Error('Missing clone launchers.');
  const menuItem = menu;
  // SAFETY: the SDK collector records commands at runtime but omits them from its CapturedPluginApp declaration.
  const command = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions[0];
  if (!command) throw new Error('Missing clone command.');
  const Overlay = overlay.component;
  function Surface() {
    const composer = useComposer();
    return <>
      <button type="button" onClick={() => { void menuItem.run({ composer }); }}>Composer launcher</button>
      <button type="button" onClick={() => { void command.run({ projectId: composer.scope.kind === 'new-thread' ? composer.scope.projectId : 'proj-old',
        threadId: composer.scope.kind === 'thread' ? composer.scope.threadId : null, openPanel: () => false }); }}>Palette launcher</button>
      <Overlay />
    </>;
  }
  const slot = renderSlot<object, typeof rpcContract>({ component: Surface }, {}, {
    sidebarThreads: { projects: options.projects ?? [{ id: 'proj-atlas', name: 'atlas', isPersonal: false, href: '/projects/proj-atlas', settingsHref: '/projects/proj-atlas/settings' }] },
    composer: options.composer ?? { scope: { kind: 'new-thread', projectId: null }, text: 'Analyse this repository', selection: { providerId: 'codex' } },
    rpc: {
      init: () => ({ defaultRoot: '/tmp/repos', existing: [] }),
      list: () => ({ ok: true, repositories: [atlas, compass], hasMore: false }),
      open: () => ({ ok: true, projectId: 'proj-atlas', path: '/tmp/repos/atlas' }),
      ...options.rpc,
    },
  });
  return { app, slot, rerender: () => slot.lifecycle.rerender(<Surface />) };
}

test('composer and palette open one shared dialog without changing the prompt', async () => {
  const { app, slot } = await render();
  expect(app.composerCustomizations[0]?.scopes).toEqual(['new-thread']);
  fireEvent.click(slot.getByRole('button', { name: 'Composer launcher' }));
  await slot.findByRole('option', { name: 'acme/atlas' });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  expect(slot.getAllByRole('dialog', { name: 'Clone repository' })).toHaveLength(1);
  expect(slot.inspection.composer.text).toBe('Analyse this repository');
  fireEvent.click(slot.getByRole('button', { name: 'Close clone repository' }));
  expect(slot.queryByRole('dialog')).toBeNull();
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  expect(await slot.findByRole('dialog')).toBeTruthy();
});

test('opening from the new-chat composer preserves prompt, mentions and attachments', async () => {
  const { slot } = await render({ composer: {
    scope: { kind: 'new-thread', projectId: 'proj-old' }, text: 'Read plan',
    mentions: [{ kind: 'path', label: 'plan', path: 'plan.md', source: 'workspace', entryKind: 'file', from: 5, to: 9 }],
    attachments: [{ type: 'localFile', path: '/tmp/brief.txt', name: 'brief.txt' }], selection: { providerId: 'codex', model: 'test-model' },
  } });
  const draft = slot.inspection.composer.draft;
  fireEvent.click(slot.getByRole('button', { name: 'Composer launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  expect((slot.getByRole('textbox', { name: 'Destination' }) as HTMLInputElement).value).toBe('/tmp/repos/atlas');
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(slot.inspection.composer.selection).toMatchObject({ projectId: 'proj-atlas', providerId: 'codex', model: 'test-model' });
  expect(slot.inspection.composer.draft).toEqual(draft);
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.inspection.composer.focusCount).toBe(1);
});

test('palette preserves a projectless new-chat prompt and opens a fresh composer from an existing thread', async () => {
  const first = await render();
  fireEvent.click(first.slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await first.slot.findByRole('option', { name: 'acme/atlas' }));
  fireEvent.click(first.slot.getByRole('button', { name: 'Clone and open' }));
  await waitFor(() => expect(first.slot.inspection.composer.selection?.projectId).toBe('proj-atlas'));
  expect(first.slot.inspection.composer.text).toBe('Analyse this repository');
  first.slot.lifecycle.unmount();
  const second = await render({ composer: { scope: { kind: 'thread', threadId: 'thread-old' }, text: 'Existing conversation draft' } });
  fireEvent.click(second.slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await second.slot.findByRole('option', { name: 'acme/atlas' }));
  fireEvent.click(second.slot.getByRole('button', { name: 'Clone and open' }));
  await waitFor(() => expect(second.slot.inspection.navigateCalls).toEqual([{ method: 'toCompose', options: { projectId: 'proj-atlas', focusPrompt: true } }]));
  expect(second.slot.inspection.composer.text).toBe('Existing conversation draft');
  expect(second.slot.inspection.composer.submits).toEqual([]);
});

test('first-page search stays usable while later pages load and errors offer retry', async () => {
  let resolvePage: ((value: { ok: true; repositories: typeof atlas[]; hasMore: false }) => void) | undefined;
  const laterPage = new Promise<{ ok: true; repositories: typeof atlas[]; hasMore: false }>(resolve => { resolvePage = resolve; });
  const { slot } = await render({ rpc: { list: input => input.page === 1
    ? { ok: true, repositories: [atlas], hasMore: true } : laterPage } });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  await slot.findByRole('option', { name: 'acme/atlas' });
  expect(slot.getByText('Searching 1 loaded repositories. Loading more…')).toBeTruthy();
  fireEvent.change(slot.getByRole('combobox', { name: 'Find a repository' }), { target: { value: 'compass' } });
  expect(slot.queryByRole('option', { name: 'acme/compass' })).toBeNull();
  resolvePage?.({ ok: true, repositories: [compass], hasMore: false });
  expect(await slot.findByRole('option', { name: 'acme/compass' })).toBeTruthy();
  expect(slot.getByText('2 repositories loaded.')).toBeTruthy();
});

test('pasted repository names work without waiting for discovery and keyboard selection requires confirmation', async () => {
  const { slot } = await render({ rpc: { list: () => ({ ok: false, message: 'GitHub temporarily unavailable.' }) } });
  fireEvent.click(slot.getByRole('button', { name: 'Composer launcher' }));
  await slot.findByText('GitHub temporarily unavailable.');
  expect(slot.getByRole('button', { name: 'Retry loading' })).toBeTruthy();
  const search = slot.getByRole('combobox', { name: 'Find a repository' });
  fireEvent.change(search, { target: { value: 'https://github.com/example/widget' } });
  expect(slot.getByRole('option', { name: 'example/widget' })).toBeTruthy();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(slot.getByRole('button', { name: 'Clone and open' })).toBeTruthy();
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'open')).toHaveLength(0);
  expect(document.activeElement).toBe(slot.getByRole('textbox', { name: 'Destination' }));
});

test('registration failure retains checkout and retries opening with the returned path', async () => {
  let attempts = 0;
  const { slot } = await render({ rpc: { open: () => ++attempts === 1
    ? { ok: false, stage: 'register', message: 'Project creation failed.', path: '/tmp/repos/atlas' }
    : { ok: true, projectId: 'proj-atlas', path: '/tmp/repos/atlas' } } });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  expect(await slot.findByRole('button', { name: 'Retry opening' })).toBeTruthy();
  expect(slot.getByText('The checkout is kept. Retry opening without cloning again.')).toBeTruthy();
  fireEvent.click(slot.getByRole('button', { name: 'Retry opening' }));
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(attempts).toBe(2);
  expect(slot.inspection.rpcCalls.filter(call => call.method === 'open').map(call => call.input)).toEqual([
    { repository: 'acme/atlas', destination: '/tmp/repos/atlas' }, { repository: 'acme/atlas', destination: '/tmp/repos/atlas' },
  ]);
});

test('registered repositories suggest their existing checkout and allow a separate clone destination', async () => {
  const { slot } = await render({ rpc: { init: () => ({ defaultRoot: '/tmp/repos', existing: [{ repository: 'acme/atlas', projectId: 'proj-atlas', path: '/tmp/group/atlas' }] }) } });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  const destination = slot.getByRole('textbox', { name: 'Destination' }) as HTMLInputElement;
  expect(destination.value).toBe('/tmp/group/atlas');
  expect(destination.disabled).toBe(false);
  expect(slot.getByRole('button', { name: 'Open existing project' })).toBeTruthy();
  fireEvent.change(destination, { target: { value: '/tmp/other/atlas' } });
  expect(slot.getByRole('button', { name: 'Clone and open' })).toBeTruthy();
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(slot.inspection.rpcCalls.find(call => call.method === 'open')?.input).toEqual({ repository: 'acme/atlas', destination: '/tmp/other/atlas' });
});

test('busy cloning blocks dismissal and clone failures keep the chosen destination editable', async () => {
  let finish: ((value: { ok: false; stage: 'clone'; message: string }) => void) | undefined;
  const result = new Promise<{ ok: false; stage: 'clone'; message: string }>(resolve => { finish = resolve; });
  const { slot } = await render({ rpc: { open: () => result } });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  fireEvent.change(slot.getByRole('textbox', { name: 'Destination' }), { target: { value: '/tmp/group/atlas' } });
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  const dialog = slot.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(slot.queryByRole('dialog')).toBeTruthy();
  expect((slot.getByRole('button', { name: 'Close clone repository' }) as HTMLButtonElement).disabled).toBe(true);
  finish?.({ ok: false, stage: 'clone', message: 'SSH access failed.' });
  expect(await slot.findByText('SSH access failed.')).toBeTruthy();
  const destination = slot.getByRole('textbox', { name: 'Destination' }) as HTMLInputElement;
  expect(destination.value).toBe('/tmp/group/atlas');
  expect(destination.disabled).toBe(false);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(slot.queryByRole('dialog')).toBeNull();
});


test('new projects wait for the sidebar cache before switching the preserved draft', async () => {
  const projects: PluginSidebarProject[] = [];
  const { slot, rerender } = await render({ projects });
  fireEvent.click(slot.getByRole('button', { name: 'Palette launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  await slot.findByText('Waiting for BB’s project list…');
  expect(slot.inspection.composer.selections).toEqual([]);
  expect(slot.inspection.composer.text).toBe('Analyse this repository');
  projects.push({ id: 'proj-atlas', name: 'atlas', isPersonal: false, href: '/projects/proj-atlas', settingsHref: '/projects/proj-atlas/settings' });
  rerender();
  await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
  expect(slot.inspection.composer.selection?.projectId).toBe('proj-atlas');
  expect(slot.inspection.composer.text).toBe('Analyse this repository');
  expect(slot.inspection.composer.submits).toEqual([]);
});

test('a sidebar refresh timeout preserves the prompt and reports the ready project', async () => {
  const { slot } = await render({ projects: [] });
  fireEvent.click(slot.getByRole('button', { name: 'Composer launcher' }));
  fireEvent.click(await slot.findByRole('option', { name: 'acme/atlas' }));
  vi.useFakeTimers();
  fireEvent.click(slot.getByRole('button', { name: 'Clone and open' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(slot.getByRole('alert').textContent).toContain('Project ready. BB has not refreshed its project list.');
  expect(slot.inspection.composer.text).toBe('Analyse this repository');
  expect(slot.inspection.composer.selections).toEqual([]);
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(slot.inspection.navigateCalls).toEqual([]);
});
