// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers, RenderSlotOptions } from '@get-bb/plugin-sdk/testing/app';
import type { accountsContract as rpcContract } from './contracts.ts';

const profiles = [
  { id: 'default', label: 'Default', configDir: null },
  { id: 'work', label: 'work', configDir: '/profiles/work' },
  { id: 'client', label: 'client', configDir: '/profiles/client' },
];
const newThread = { scope: { kind: 'new-thread' as const, projectId: 'project-test' }, selection: { providerId: 'claude-code' } };
const thread = { scope: { kind: 'thread' as const, threadId: 'thread-test' } };
type Composer = NonNullable<RenderSlotOptions<typeof rpcContract>['composer']>;

async function render(part: 'button' | 'menu', composer: Composer, rpc: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const customization = app.composerCustomizations[0];
  const registration = part === 'button' ? customization?.actions?.[0] : customization?.experimental_popups?.[0];
  if (!registration) throw new Error(`Missing ${part}.`);
  let currentId = 'default';
  return renderSlot<object, typeof rpcContract>(registration, {}, { composer, rpc: {
    accounts: () => ({ supported: true, profiles, currentId }),
    choose: input => { currentId = input.profileId; return { currentId }; },
    usage: () => { throw new Error('The switcher must not request quota.'); },
    ...rpc,
  } });
}
const choices = (slot: Awaited<ReturnType<typeof render>>) => slot.inspection.rpcCalls.filter(call => call.method === 'choose');

test('the new-thread composer shows the remembered account for Claude Code', async () => {
  const slot = await render('button', newThread, { accounts: () => ({ supported: true, profiles, currentId: 'work' }) });
  try {
    expect((await slot.findByRole('button', { name: /Claude account/ })).textContent).toBe('work');
    expect(slot.inspection.rpcCalls.find(call => call.method === 'accounts')?.input).toEqual({ threadId: null });
  } finally { slot.lifecycle.unmount(); }
});

test('the account picker hides when the new-thread composer selects another provider', async () => {
  const slot = await render('button', { ...newThread, selection: { providerId: 'codex' } });
  try {
    await waitFor(() => expect(slot.inspection.rpcCalls.some(call => call.method === 'accounts')).toBe(true));
    expect(slot.queryByRole('button')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('a running thread disables the account picker', async () => {
  const slot = await render('button', { ...thread, isRunning: true });
  try {
    expect((await slot.findByRole('button', { name: /Claude account/ })).hasAttribute('disabled')).toBe(true);
  } finally { slot.lifecycle.unmount(); }
});

test('choosing in the new-thread composer remembers the account without a thread', async () => {
  const slot = await render('menu', newThread);
  try {
    fireEvent.click(await slot.findByRole('menuitemradio', { name: /work/ }));
    await waitFor(() => expect(choices(slot)).toHaveLength(1));
    expect(choices(slot)[0]?.input).toEqual({ threadId: null, profileId: 'work' });
    expect(slot.getByRole('menu').textContent).toContain('New Claude threads start on this account.');
  } finally { slot.lifecycle.unmount(); }
});

test('number keys and Enter switch the thread account', async () => {
  const slot = await render('menu', thread);
  try {
    const menu = await slot.findByRole('menu');
    fireEvent.keyDown(menu, { key: '3' });
    await waitFor(() => expect(choices(slot)[0]?.input).toEqual({ threadId: 'thread-test', profileId: 'client' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    await waitFor(() => expect(choices(slot)).toHaveLength(2));
  } finally { slot.lifecycle.unmount(); }
});

test('a refused switch explains why and keeps the current account', async () => {
  const slot = await render('menu', thread, { choose: () => { throw new Error('Finish or stop the turn first.'); } });
  try {
    fireEvent.click(await slot.findByRole('menuitemradio', { name: /client/ }));
    expect((await slot.findByRole('alert')).textContent).toContain('Finish or stop');
    expect(slot.getByRole('menuitemradio', { name: /Default/ }).getAttribute('aria-checked')).toBe('true');
  } finally { slot.lifecycle.unmount(); }
});

test.each(['q', 'Q', 'Escape'])('%s closes the menu without switching', async key => {
  const slot = await render('menu', thread);
  try {
    fireEvent.keyDown(await slot.findByRole('menu'), { key });
    expect(choices(slot)).toHaveLength(0);
  } finally { slot.lifecycle.unmount(); }
});
