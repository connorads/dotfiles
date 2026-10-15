// @vitest-environment jsdom
import { beforeAll, test, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { initialState, type CacheState } from './src/cache.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

const props = { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false };
const hour = 3_600_000;

async function render(thread: PluginRpcTestHandlers<typeof rpcContract>['thread']) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.threadHeaderActions[0];
  if (!registration) throw new Error('Missing cache action.');
  return renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: { thread, invalidate: () => { throw new Error('The chip must not invalidate.'); } } });
}

test('Codex: shows the last request hit rate and miss count, without a countdown', async () => {
  const state: CacheState = { ...initialState(), last: { at: 2, prompt: 100000, read: 92000, write: 0, ttlMs: null, model: null },
    prompt: 200000, read: 190000, misses: 2, missedTokens: 140000, lastMiss: { at: 2, tokens: 90000, idleMs: 420000, cause: 'idle' } };
  const slot = await render(() => state);
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toBe('92%2');
    expect(chip.getAttribute('title')).toBe('Last request: 92% cached (read 92k, wrote 0 of 100k)\nThread: 95% cached\n2 misses, 140k re-sent; last 90k, after 7m idle');
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: counts down the cache lifetime in whole minutes', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 182593, read: 180933,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour, model: null } }));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toMatch(/^5[89]m$/);
    expect(chip.getAttribute('title')).toMatch(/^Cache expires in 5[89]:\d\d \(1h lifetime\)\n/);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: shows cold and the rebuild size once the lifetime has passed', async () => {
  const at = Date.now() - 2 * hour;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 182593, read: 180933,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour, model: null } }));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toBe('cold');
    expect(chip.getAttribute('title')).toMatch(/^Cache expired 60m ago; the next request rebuilds 183k\n/);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: an account switch shows cold at once and names the switch as the miss cause', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 400000, read: 300000, misses: 1, missedTokens: 200000,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour, model: null }, invalidatedAt: Date.now() - 1000,
    lastMiss: { at: at - hour, tokens: 200000, idleMs: 5000, cause: 'account' } }));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toBe('cold1');
    expect(chip.getAttribute('title')).toMatch(/^Claude account switched; the next request rebuilds 183k\n/);
    expect(chip.getAttribute('title')).toMatch(/last 200k, account switched$/);
  } finally { slot.lifecycle.unmount(); }
});

test('renders nothing before the thread reports usage', async () => {
  const slot = await render(() => initialState());
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slot.queryByRole('button')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: a click opens the countdown, rebuild cost, per-request chart and recent misses', async () => {
  const at = Date.now() - 60_000;
  const history = [
    { at: at - 3 * hour, prompt: 90000, read: 0, write: 90000, miss: null, afterReset: false },
    { at: at - 2 * hour, prompt: 120000, read: 0, write: 120000, miss: { tokens: 90000, idleMs: hour + 300_000, cause: 'expired' as const }, afterReset: false },
    { at, prompt: 182593, read: 180933, write: 1658, miss: null, afterReset: false },
  ];
  const slot = await render(() => ({ ...initialState(), ttlMs: hour, prompt: 392593, read: 180933, misses: 1, missedTokens: 90000,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour, model: null }, history,
    lastMiss: { at: at - 2 * hour, tokens: 90000, idleMs: hour + 300_000, cause: 'expired' } }));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    const dialog = await slot.findByRole('dialog', { name: 'Prompt cache' });
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelector('.ch-headline')?.textContent).toMatch(/^5[89]:\d\dleft of 1h/);
    expect(dialog.querySelector('.ch-note')?.textContent).toBe('Each request resets the 1h clock. Going cold rewrites 183k at 2× the input price.');
    expect(dialog.querySelectorAll('.ch-bars > li')).toHaveLength(3);
    expect(dialog.querySelector('.ch-bars > li[data-miss="expired"]')?.getAttribute('title')).toMatch(/miss: 90k re-sent, expired after 1h 5m idle$/);
    expect(dialog.querySelector('.ch-misses li')?.textContent).toMatch(/90kexpired after 1h 5m idle$/);
    fireEvent.click(chip);
    expect(slot.queryByRole('dialog')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});
