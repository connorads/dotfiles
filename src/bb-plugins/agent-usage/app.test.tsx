// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import { closeUsage, openUsage } from './overlay-store.ts';
import type { Header, Snapshot } from './contracts.ts';

const NOW = new Date('2026-10-12T12:00:00Z');
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const header: Header = { providerId: 'codex', label: 'Codex', accountLabel: 'personal@example.com', message: null,
  windows: [{ label: 'Weekly', period: 'week', usedPercent: 6, resetsAt: hoursFromNow(100), cost: null }] };
const account = (name: string, accountLabel: string, windows: Header['windows']) => ({ id: `${name}:${accountLabel}`,
  providerId: name.toLowerCase(), displayName: name, accountLabel, logoUrl: null, icon: null, strings: { iconTint: null },
  signInHint: 'Sign in', expiredHint: 'Sign in again', usage: { status: 'ok' as const, accountEmail: null, planLabel: 'Pro', windows } });
const snapshot: Snapshot = { machines: [{ id: 'host-one', displayName: 'Laptop', status: 'connected', error: null, providers: [
  account('Codex', 'Personal', [{ label: 'Weekly', period: 'week', usedPercent: 6, resetsAt: hoursFromNow(100), cost: null }]),
  account('Claude', 'Work', [{ label: 'Weekly', period: 'week', usedPercent: 100, resetsAt: hoursFromNow(30), cost: null }]),
  account('Claude', 'Spare', [{ label: 'Weekly', period: 'week', usedPercent: 12, resetsAt: hoursFromNow(30), cost: null },
    { label: 'Credits', period: null, usedPercent: 0.5, resetsAt: hoursFromNow(400), cost: { usedUsdCents: 125, limitUsdCents: 25000 } }]),
] }] };

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { closeUsage(); cleanup(); vi.useRealTimers(); });

test('header shows the binding window without inventing a five-hour window', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: 'thread-one', projectId: 'project-one', isCompactViewport: false },
    { rpc: { header: async () => header } });
  const button = await slot.findByRole('button', { name: /Codex.*Weekly: 6% used/s });
  expect(button.textContent).toBe('7d 6%');
  expect(button.dataset.tone).toBe('normal');
  expect(button.title).toContain('personal@example.com');
});

test('header warns with the projected run-out time when use outpaces the window', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  // Three of five hours elapsed and 90% used: 30%/h, so the last 10% lasts 20 minutes.
  const fast: Header = { ...header, windows: [
    { label: '5-hour', period: 'five-hour', usedPercent: 90, resetsAt: hoursFromNow(2), cost: null }, ...header.windows] };
  const slot = renderSlot(app.threadHeaderActions[0], { threadId: 'thread-one', projectId: 'project-one', isCompactViewport: false },
    { rpc: { header: async () => fast } });
  const button = await slot.findByRole('button', { name: /Open all agent usage/ });
  await waitFor(() => expect(button.textContent).toMatch(/^5h 90% · out \d{1,2}:20( [AP]M)?$/));
  expect(button.dataset.tone).toBe('critical');
});

test('overlay groups accounts by provider, explains pace and keeps figures when a refresh fails', async () => {
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
  expect(slot.getByRole('region', { name: 'Claude' }).querySelectorAll('.au-account')).toHaveLength(2);
  expect(slot.getByRole('row', { name: /^Weekly: 100% used\. Limit reached/ })).toBeTruthy();
  expect(slot.getByRole('row', { name: /^Credits: <1% used\. \$1\.25 of \$250\.$/ })).toBeTruthy();
  const summary = slot.getByRole('status', { name: '' }).textContent ?? '';
  expect(summary).toContain('Work · Weekly limit reached.');
  expect(summary).toContain('Spare has the most room (12% of weekly).');
  fireEvent.click(slot.getByRole('button', { name: 'Refresh' }));
  expect((await slot.findByRole('alert')).textContent).toContain('Showing previous figures');
  expect(slot.getByRole('region', { name: 'Codex · Personal' })).toBeTruthy();
  expect(requests).toEqual([{ refresh: false }, { refresh: true }]);
});

test('a window whose reset has passed shows no stale percentage', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const stale: Snapshot = { machines: [{ ...snapshot.machines[0]!, providers: [account('Codex', 'Personal',
    [{ label: 'Weekly', period: 'week', usedPercent: 78, resetsAt: hoursFromNow(-1), cost: null }])] }] };
  const slot = renderSlot(app.appOverlays[0], {}, { rpc: { overview: async () => stale } });
  act(() => openUsage());
  const row = await slot.findByRole('row', { name: /Reset since last check/ });
  expect(row.textContent).not.toContain('78%');
});

test.each(['Escape', 'q', 'Q'])('%s dismisses the overlay and restores focus to the previous control', async key => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const slot = renderSlot(app.appOverlays[0], {}, { rpc: { overview: async () => snapshot } });
  const origin = document.createElement('button');
  document.body.append(origin);
  try {
    origin.focus();
    act(() => openUsage());
    const dialog = await slot.findByRole('dialog');
    fireEvent.keyDown(dialog, { key });
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
