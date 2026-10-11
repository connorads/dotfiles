// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import { closeUsage, openUsage } from './overlay-store.ts';
import type { Header, Snapshot } from './contracts.ts';

const header: Header = { providerId: 'codex', label: 'Codex', accountLabel: 'personal@example.com', message: null,
  windows: [{ label: 'Weekly limit', usedPercent: 6, resetsAt: '2026-12-01T12:00:00Z', cost: null }] };
const snapshot: Snapshot = { machines: [{ id: 'host-one', displayName: 'Laptop', status: 'connected', error: null,
  providers: ['Codex', 'Claude'].map((name, index) => ({ id: name, providerId: name.toLowerCase(), displayName: name,
    accountLabel: index ? 'Work' : 'Personal', logoUrl: null, icon: null, strings: { iconTint: null },
    signInHint: 'Sign in', expiredHint: 'Sign in again', usage: { status: 'ok', accountEmail: null, planLabel: 'Pro',
      windows: [{ label: 'Weekly limit', usedPercent: index ? 81 : 6, resetsAt: null, cost: null }] } })) }] };

afterEach(() => { closeUsage(); cleanup(); });

test('header shows the reported weekly quota without inventing a five-hour window', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: 'thread-one', projectId: 'project-one', isCompactViewport: false },
    { rpc: { header: async () => header } });
  const button = await slot.findByRole('button', { name: /Codex.*Weekly limit/s });
  expect(button.textContent).toContain('7d 6%');
  expect(button.textContent).not.toContain('5h');
  expect(button.title).toContain('personal@example.com');
});

test('opening the overlay shows all accounts and forced refresh keeps the previous figures on failure', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const requests: unknown[] = [];
  const slot = renderSlot(app.appOverlays[0], {}, { rpc: { overview: async input => {
    requests.push(input);
    if (requests.length > 1) throw new Error('Machine disconnected');
    return snapshot;
  } } });
  act(() => openUsage());
  const dialog = await slot.findByRole('dialog', { name: 'Agent usage' });
  expect(dialog.className).toContain('au-overlay');
  expect(await slot.findByRole('region', { name: 'Codex · Personal' })).toBeTruthy();
  expect(slot.getByRole('region', { name: 'Claude · Work' })).toBeTruthy();
  fireEvent.click(slot.getByRole('button', { name: 'Refresh' }));
  expect((await slot.findByRole('alert')).textContent).toContain('Showing previous figures');
  expect(slot.getByRole('region', { name: 'Codex · Personal' })).toBeTruthy();
  expect(requests).toEqual([{ refresh: false }, { refresh: true }]);
});

test('Escape dismisses the overlay and restores focus to the previous control', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const slot = renderSlot(app.appOverlays[0], {}, { rpc: { overview: async () => snapshot } });
  const origin = document.createElement('button');
  document.body.append(origin);
  try {
    origin.focus();
    act(() => openUsage());
    const dialog = await slot.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(slot.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origin));
  } finally { origin.remove(); }
});

test('the rebindable usage command opens the overlay', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const actions = Reflect.get(app, 'commandPaletteActions') as PluginCommandRegistration[];
  const command = actions.find(action => action.id === 'open');
  if (!command) throw new Error('Missing usage command');
  expect(command.defaultShortcut).toMatchObject({ key: 'a', mod: true, shift: true });
  const slot = renderSlot(app.appOverlays[0], {}, { rpc: { overview: async () => snapshot } });
  await act(async () => { await command.run({ threadId: null, projectId: null, openPanel: () => false }); });
  expect(await slot.findByRole('dialog', { name: 'Agent usage' })).toBeTruthy();
});
