// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { rpcContract } from './contracts.ts';
import type { PluginCommandContext, PluginCommandRegistration, PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';

const props = { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false };
const profiles = [
  { id: 'default', label: 'Default', configDir: null },
  { id: 'work', label: 'work', configDir: '/profiles/work' },
  { id: 'client', label: 'client', configDir: '/profiles/client' },
];
async function render(rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.threadHeaderActions[0];
  if (!registration) throw new Error('Missing profile action.');
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: {
    thread: () => ({ supported: true, profiles, selection: null }),
    switch: input => ({ hostId: 'host-test', profile: profiles.find(profile => profile.id === input.profileId)! }),
    usage: () => { throw new Error('The switcher must not request quota.'); },
    ...rpc,
  } });
  return { app, slot };
}

test('the switcher shows account names without requesting quota', async () => {
  const { slot } = await render();
  try {
    const button = await slot.findByRole('button', { name: /Claude account/ });
    expect(button.textContent).toBe('Default');
    fireEvent.click(button);
    expect((await slot.findByRole('menuitemradio', { name: /work/ })).textContent).toBe('2work');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'usage')).toHaveLength(0);
    expect(slot.getByRole('menu').textContent).not.toContain('refresh');
  } finally { slot.lifecycle.unmount(); }
});

test('one click on an account row switches the thread and closes the menu', async () => {
  const { slot } = await render();
  try {
    fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
    fireEvent.click(await slot.findByRole('menuitemradio', { name: /work/ }));
    await waitFor(() => expect(slot.queryByRole('menu')).toBe(null));
    expect(slot.getByRole('button', { name: /Claude account/ }).textContent).toContain('work');
    expect(slot.inspection.rpcCalls.filter(call => call.method === 'switch')).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); }
});

test('number keys switch accounts and Escape closes the menu', async () => {
  const { slot } = await render();
  try {
    fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
    const menu = await slot.findByRole('menu');
    fireEvent.keyDown(menu, { key: '3' });
    await waitFor(() => expect(slot.queryByRole('menu')).toBe(null));
    expect(slot.getByRole('button', { name: /Claude account/ }).textContent).toContain('client');
    fireEvent.click(slot.getByRole('button', { name: /Claude account/ }));
    fireEvent.keyDown(await slot.findByRole('menu'), { key: 'Escape' });
    expect(slot.queryByRole('menu')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});

test('arrow keys move focus and Enter switches to the focused account', async () => {
  const { slot } = await render();
  try {
    fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
    const menu = await slot.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('work');
    fireEvent.keyDown(menu, { key: 'Enter' });
    await waitFor(() => expect(slot.getByRole('button', { name: /Claude account/ }).textContent).toContain('work'));
  } finally { slot.lifecycle.unmount(); }
});

test('failed switch keeps the menu open and explains the refusal', async () => {
  const { slot } = await render({ switch: () => { throw new Error('Finish or stop the turn first.'); } });
  try {
    fireEvent.click(await slot.findByRole('button', { name: /Claude account/ }));
    fireEvent.click(await slot.findByRole('menuitemradio', { name: /client/ }));
    expect((await slot.findByRole('alert')).textContent).toContain('Finish or stop');
    expect(slot.getByRole('menuitemradio', { name: /Default/ }).getAttribute('aria-checked')).toBe('true');
  } finally { slot.lifecycle.unmount(); }
});

test('the open-switcher command opens the menu for the thread in view', async () => {
  const { app, slot } = await render();
  try {
    // The test runtime captures commands, but CapturedPluginApp does not type them.
    const { commandPaletteActions } = app as unknown as { commandPaletteActions: (PluginCommandRegistration & { target: string })[] };
    const command = commandPaletteActions.find(action => action.id === 'open-switcher');
    if (!command || command.target !== 'app') throw new Error('Missing open-switcher command.');
    expect(command.defaultShortcut).toBeNull();
    const context = { threadId: 'thread-test', projectId: 'project-test', openPanel: () => false } satisfies PluginCommandContext;
    await waitFor(() => expect(command.isAvailable?.(context)).toBe(true));
    expect(command.isAvailable?.({ ...context, threadId: 'other-thread' })).toBe(false);
    await act(async () => { await command.run(context); });
    expect(await slot.findByRole('menu')).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});
