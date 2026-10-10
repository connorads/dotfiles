// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { initialState, type CacheState } from './src/cache.ts';

const props = { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false };

async function render(thread: PluginRpcTestHandlers<typeof rpcContract>['thread']) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.threadHeaderActions[0];
  if (!registration) throw new Error('Missing cache action.');
  return renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(registration, props, { rpc: { thread } });
}

test('shows the last request hit rate, miss count and detail', async () => {
  const state: CacheState = { ...initialState('codex'), last: { at: 2, prompt: 100000, read: 92000, write: 0 },
    prompt: 200000, read: 190000, misses: 2, missedTokens: 140000, lastMiss: { at: 2, tokens: 90000, idleMs: 420000 } };
  const slot = await render(() => state);
  try {
    const chip = await slot.findByRole('status');
    expect(chip.textContent).toBe('cache92%2 miss');
    expect(chip.getAttribute('title')).toBe('Last request: 92% cached (read 92k, wrote 0 of 100k)\nThread: 95% cached\n2 misses, 140k re-sent; last 90k after 7m');
  } finally { slot.lifecycle.unmount(); }
});

test('renders nothing before the thread reports usage', async () => {
  const slot = await render(() => initialState('claude-code'));
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(slot.queryByRole('status')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});
