// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { initialState, type CacheState } from './src/cache.ts';

const props = { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false };
const hour = 3_600_000;

async function render(thread: PluginRpcTestHandlers<typeof rpcContract>['thread']) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.threadHeaderActions[0];
  if (!registration) throw new Error('Missing cache action.');
  return renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: { thread, invalidate: () => { throw new Error('The chip must not invalidate.'); } } });
}

test('Codex: shows the last request hit rate, miss count and detail, without a countdown', async () => {
  const state: CacheState = { ...initialState(), last: { at: 2, prompt: 100000, read: 92000, write: 0, ttlMs: null },
    prompt: 200000, read: 190000, misses: 2, missedTokens: 140000, lastMiss: { at: 2, tokens: 90000, idleMs: 420000, cause: 'idle' } };
  const slot = await render(() => state);
  try {
    const chip = await slot.findByRole('status');
    expect(chip.textContent).toBe('hit92%2 miss');
    expect(chip.getAttribute('title')).toBe('Last request: 92% cached (read 92k, wrote 0 of 100k)\nThread: 95% cached\n2 misses, 140k re-sent; last 90k after 7m');
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: counts down the cache lifetime from the last request', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 182593, read: 180933,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour } }));
  try {
    const chip = await slot.findByRole('status');
    expect(chip.textContent).toMatch(/^5[89]:\d\dhit99%$/);
    expect(chip.getAttribute('title')).toMatch(/^Cache expires in 5[89]:\d\d \(1h lifetime\)\n/);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: shows cold and the rebuild size once the lifetime has passed', async () => {
  const at = Date.now() - 2 * hour;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 182593, read: 180933,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour } }));
  try {
    const chip = await slot.findByRole('status');
    expect(chip.textContent).toBe('coldhit99%');
    expect(chip.getAttribute('title')).toMatch(/^Cache expired 60m ago; the next request rebuilds 183k\n/);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: an account switch shows cold at once and names the switch as the miss cause', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 400000, read: 300000, misses: 1, missedTokens: 200000,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour }, invalidatedAt: Date.now() - 1000,
    lastMiss: { at: at - hour, tokens: 200000, idleMs: 5000, cause: 'account' } }));
  try {
    const chip = await slot.findByRole('status');
    expect(chip.textContent).toBe('coldhit99%1 miss');
    expect(chip.getAttribute('title')).toMatch(/^Claude account switched; the next request rebuilds 183k\n/);
    expect(chip.getAttribute('title')).toMatch(/last 200k after account switch$/);
  } finally { slot.lifecycle.unmount(); }
});

test('renders nothing before the thread reports usage', async () => {
  const slot = await render(() => initialState());
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slot.queryByRole('status')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});
