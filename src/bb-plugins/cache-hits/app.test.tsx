// @vitest-environment jsdom
import { afterEach, beforeAll, test, expect, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { initialState, type CacheState } from './src/cache.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { vi.useRealTimers(); });

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
    expect(chip.getAttribute('title')).toMatch(/^Cache expired 1h 0m ago; the next request rebuilds 183k\n/);
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
    const picker = slot.getByRole('combobox', { name: 'Request details' });
    expect(picker.querySelectorAll('option')).toHaveLength(3);
    expect(slot.getByRole('status').textContent).toContain('read 181k');
    fireEvent.change(picker, { target: { value: '1' } });
    expect(slot.getByRole('status').textContent).toContain('miss: 90k re-sent, expired after 1h 5m idle');
    fireEvent.change(picker, { target: { value: '0' } });
    expect(slot.getByRole('status').textContent).toContain('90k prompt');
    expect(slot.getByRole('status').textContent).not.toContain('miss:');
    fireEvent.click(chip);
    expect(slot.queryByRole('dialog')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});

function claudeState(at: number, extra: Partial<CacheState> = {}): CacheState {
  return { ...initialState(), ttlMs: hour, prompt: 182593, read: 180933,
    last: { at, prompt: 182593, read: 180933, write: 1658, ttlMs: hour, model: null },
    history: [{ at, prompt: 182593, read: 180933, write: 1658, miss: null, afterReset: false }], ...extra };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('a late reply for the previous thread never shows on the thread the pane switched to', async () => {
  const at = Date.now() - 60_000;
  const codex: CacheState = { ...initialState(), prompt: 100000, read: 65000,
    last: { at, prompt: 100000, read: 65000, write: 0, ttlMs: null, model: null } };
  let release: (state: CacheState) => void = () => {};
  let calls = 0;
  const slot = await render(input => input.threadId === 'thread-other' ? codex
    : calls++ === 0 ? claudeState(at) : new Promise<CacheState>(resolve => { release = resolve; }));
  try {
    expect((await slot.findByRole('button')).textContent).toMatch(/^5[89]m$/);
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    const app = await loadPluginApp(() => import('./app.tsx'));
    const Component = app.threadHeaderActions[0]!.component;
    slot.lifecycle.rerender(<Component {...props} threadId="thread-other" />);
    await tick();
    expect(slot.getByRole('button').textContent).toBe('65%');
    await act(async () => { release(claudeState(at)); await tick(); });
    expect(slot.getByRole('button').textContent).toBe('65%');
  } finally { slot.lifecycle.unmount(); }
});

test('a failed refresh keeps the chip, the open popover and the chosen request', async () => {
  const at = Date.now() - 60_000;
  const history = [
    { at: at - hour, prompt: 90000, read: 0, write: 90000, miss: null, afterReset: false },
    { at, prompt: 182593, read: 180933, write: 1658, miss: null, afterReset: false },
  ];
  let calls = 0;
  const slot = await render(() => { if (calls++ === 0) return claudeState(at, { history }); throw new Error('Sync store unavailable'); });
  try {
    fireEvent.click(await slot.findByRole('button'));
    const picker = await slot.findByRole('combobox', { name: 'Request details' });
    fireEvent.change(picker, { target: { value: '0' } });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await tick();
    expect(slot.getByRole('button', { name: /^Prompt cache/ }).textContent).toMatch(/^5[89]m$/);
    expect(slot.getByRole('dialog', { name: 'Prompt cache' })).toBeTruthy();
    expect(slot.getByRole('status').textContent).toContain('90k prompt');
  } finally { slot.lifecycle.unmount(); }
});

test('after compaction hides an open popover, the next request brings back the chip with the popover closed', async () => {
  const at = Date.now() - 60_000;
  const states = [claudeState(at), { ...claudeState(at), last: null }, claudeState(at + 30_000)];
  let calls = 0;
  const slot = await render(() => states[Math.min(calls++, states.length - 1)]!);
  try {
    fireEvent.click(await slot.findByRole('button'));
    await slot.findByRole('dialog', { name: 'Prompt cache' });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await tick();
    expect(slot.queryByRole('button')).toBe(null);
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await tick();
    expect(slot.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    expect(slot.queryByRole('dialog')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});

test('Codex: a miss bar draws its re-sent tokens in red, though Codex reports no writes', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), prompt: 220000, read: 130000, misses: 1, missedTokens: 60000,
    last: { at, prompt: 120000, read: 60000, write: 0, ttlMs: null, model: null },
    lastMiss: { at, tokens: 60000, idleMs: 600_000, cause: 'idle' },
    history: [
      { at: at - 600_000, prompt: 100000, read: 70000, write: 0, miss: null, afterReset: false },
      { at, prompt: 120000, read: 60000, write: 0, miss: { tokens: 40000, idleMs: 600_000, cause: 'idle' }, afterReset: false },
    ] }));
  try {
    fireEvent.click(await slot.findByRole('button'));
    const bar = (await slot.findByRole('dialog')).querySelector<HTMLElement>('.ch-bars > li[data-miss]')!;
    const height = (part: string) => bar.querySelector<HTMLElement>(`[data-part="${part}"]`)!.style.height;
    expect([height('miss'), height('rest'), height('read')]).toEqual([`${(40000 / 120000) * 100}%`, `${(20000 / 120000) * 100}%`, `${(60000 / 120000) * 100}%`]);
  } finally { slot.lifecycle.unmount(); }
});

test('a failed refresh is tried again, so the chip catches up with the request that triggered it', async () => {
  const at = Date.now() - 60_000;
  let calls = 0;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (calls === 2) throw new Error('Sync store unavailable');
    return claudeState(at, { invalidatedAt: Date.now() - 1000 });
  });
  try {
    expect((await slot.findByRole('button')).textContent).toMatch(/^5[89]m$/);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { await Promise.resolve(); });
    expect(calls).toBe(2);
    expect(slot.getByRole('button').textContent).toMatch(/^5[89]m$/);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(calls).toBe(3);
    expect(slot.getByRole('button').textContent).toBe('cold');
  } finally { slot.lifecycle.unmount(); }
});

test('a failed first load is tried again, so one transient failure does not hide the chip', async () => {
  const at = Date.now() - 60_000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let calls = 0;
  const slot = await render(() => { if (calls++ === 0) throw new Error('Sync store unavailable'); return claudeState(at); });
  try {
    await act(async () => { await Promise.resolve(); });
    expect(slot.queryByRole('button')).toBe(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(calls).toBe(2);
    expect(slot.getByRole('button').textContent).toMatch(/^5[89]m$/);
  } finally { slot.lifecycle.unmount(); }
});

test('Request details keeps the chosen request when a refresh at the history cap drops the oldest one', async () => {
  const at = Date.now() - 60_000;
  const entry = (minutesAgo: number, prompt: number) => ({ at: at - minutesAgo * 60_000, prompt, read: prompt - 1000, write: 1000, miss: null, afterReset: false });
  const before = [entry(30, 50000), entry(20, 60000), entry(10, 70000)];
  const after = [...before.slice(1), entry(0, 80000)];
  let calls = 0;
  const slot = await render(() => claudeState(at, { history: calls++ === 0 ? before : after }));
  try {
    fireEvent.click(await slot.findByRole('button'));
    fireEvent.change(await slot.findByRole('combobox', { name: 'Request details' }), { target: { value: '1' } });
    expect(slot.getByRole('status').textContent).toContain('60k prompt');
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await tick();
    expect(slot.getByRole('status').textContent).toContain('60k prompt');
    expect(slot.getByRole('combobox', { name: 'Request details' })).toHaveProperty('value', '0');
    expect(slot.getByRole('dialog').querySelectorAll('.ch-bars > li[data-selected]')).toHaveLength(1);
    expect(slot.getByRole('dialog').querySelector('.ch-bars > li')?.hasAttribute('data-selected')).toBe(true);
  } finally { slot.lifecycle.unmount(); }
});

test('Codex: the chart legend names uncached input and leaves out writes Codex never reports', async () => {
  const at = Date.now() - 60_000;
  const slot = await render(() => ({ ...initialState(), prompt: 220000, read: 130000,
    last: { at, prompt: 120000, read: 60000, write: 0, ttlMs: null, model: null },
    history: [
      { at: at - 600_000, prompt: 100000, read: 70000, write: 0, miss: null, afterReset: false },
      { at, prompt: 120000, read: 60000, write: 0, miss: { tokens: 40000, idleMs: 600_000, cause: 'idle' }, afterReset: false },
    ] }));
  try {
    fireEvent.click(await slot.findByRole('button'));
    expect((await slot.findByRole('dialog')).querySelector('.ch-legend')?.textContent).toBe('cachedre-sentuncached');
  } finally { slot.lifecycle.unmount(); }
});

test('a refresh in flight at unmount is not tried again after unmount', async () => {
  const at = Date.now() - 60_000;
  let fail: (error: Error) => void = () => {};
  let calls = 0;
  const slot = await render(() => calls++ === 0 ? claudeState(at) : new Promise<CacheState>((_, reject) => { fail = reject; }));
  expect((await slot.findByRole('button')).textContent).toMatch(/^5[89]m$/);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
  slot.lifecycle.unmount();
  fail(new Error('Sync store unavailable'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(2);
});

test('when a newer refresh fails, a slower earlier refresh that succeeds still updates the chip', async () => {
  const at = Date.now() - 60_000;
  let release: (state: CacheState) => void = () => {};
  let calls = 0;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (calls === 2) return new Promise<CacheState>(resolve => { release = resolve; });
    throw new Error('Sync store unavailable');
  });
  try {
    expect((await slot.findByRole('button')).textContent).toMatch(/^5[89]m$/);
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { release(claudeState(at, { invalidatedAt: Date.now() - 1000 })); await tick(); });
    expect(slot.getByRole('button').textContent).toBe('cold');
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: time left never reads above the lifetime when the last request is stamped ahead of this clock', async () => {
  const slot = await render(() => claudeState(Date.now() + 5_000));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.getAttribute('title')).toMatch(/^Cache expires in 1:00:00 \(1h lifetime\)\n/);
    fireEvent.click(chip);
    expect((await slot.findByRole('dialog')).querySelector('.ch-headline strong')?.textContent).toBe('1:00:00');
  } finally { slot.lifecycle.unmount(); }
});

test('the chip name starts with the time it shows, so voice control can target it', async () => {
  const slot = await render(() => claudeState(Date.now() - 2 * hour));
  try {
    expect(await slot.findByRole('button', { name: /^Prompt cache cold\. Cache expired/ })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

test('while the newest refresh has failed, the chip and popover say the figures are out of date, until a retry succeeds', async () => {
  const at = Date.now() - 60_000;
  let calls = 0;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (calls === 2) throw new Error('Sync store unavailable');
    return claudeState(at, { invalidatedAt: Date.now() - 1000 });
  });
  try {
    const chip = await slot.findByRole('button');
    expect(chip.hasAttribute('data-stale')).toBe(false);
    fireEvent.click(chip);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { await Promise.resolve(); });
    expect(chip.hasAttribute('data-stale')).toBe(true);
    expect(chip.getAttribute('title')).toMatch(/^Not updated since .+: the last refresh failed\n/);
    expect(chip.getAttribute('aria-label')).toMatch(/^Prompt cache 5[89]m\. Not updated since/);
    expect(slot.getByRole('dialog').querySelector('.ch-stale-note')?.textContent).toMatch(/the last refresh failed\. These figures may be out of date\.$/);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(chip.textContent).toBe('cold');
    expect(chip.hasAttribute('data-stale')).toBe(false);
    expect(slot.getByRole('dialog').querySelector('.ch-stale-note')).toBe(null);
  } finally { slot.lifecycle.unmount(); }
});

test('on one thread, an older refresh that resolves after a newer one never replaces it', async () => {
  const at = Date.now() - 60_000;
  let release: (state: CacheState) => void = () => {};
  let calls = 0;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (calls === 2) return new Promise<CacheState>(resolve => { release = resolve; });
    return claudeState(at, { invalidatedAt: Date.now() - 1000 });
  });
  try {
    expect((await slot.findByRole('button')).textContent).toMatch(/^5[89]m$/);
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await tick();
    expect(slot.getByRole('button').textContent).toBe('cold');
    await act(async () => { release(claudeState(at)); await tick(); });
    expect(slot.getByRole('button').textContent).toBe('cold');
  } finally { slot.lifecycle.unmount(); }
});

test('a failing refresh is tried again after 2, 4, 8 and 16 seconds, then waits for the next request', async () => {
  const at = Date.now() - 60_000;
  let calls = 0;
  const slot = await render(() => { if (calls++ === 0) return claudeState(at); throw new Error('Sync store unavailable'); });
  try {
    await slot.findByRole('button');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { await Promise.resolve(); });
    const seen: number[] = [];
    for (const wait of [1_999, 1, 4_000, 8_000, 16_000, 60_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(wait); });
      seen.push(calls);
    }
    expect(seen).toEqual([2, 3, 4, 5, 6, 6]);
  } finally { slot.lifecycle.unmount(); }
});

test('Claude: the chip value and meter never read above the lifetime when the last request is stamped well ahead of this clock', async () => {
  const slot = await render(() => claudeState(Date.now() + 90_000));
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toBe('60m');
    fireEvent.click(chip);
    expect((await slot.findByRole('dialog')).querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('100');
  } finally { slot.lifecycle.unmount(); }
});

test('opening the popover on stale figures loads them again, after the retries have run out', async () => {
  const at = Date.now() - 60_000;
  let calls = 0;
  let healthy = false;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (!healthy) throw new Error('Sync store unavailable');
    return claudeState(at, { invalidatedAt: Date.now() - 1000 });
  });
  try {
    const chip = await slot.findByRole('button');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toBe(6);
    expect(chip.hasAttribute('data-stale')).toBe(true);
    healthy = true;
    fireEvent.click(chip);
    await act(async () => { await Promise.resolve(); });
    expect(calls).toBe(7);
    expect(chip.hasAttribute('data-stale')).toBe(false);
    expect(slot.getByRole('dialog').querySelector('.ch-headline strong')?.textContent).toBe('Cold');
    fireEvent.click(chip);
    fireEvent.click(chip);
    await act(async () => { await Promise.resolve(); });
    expect(calls).toBe(7);
  } finally { slot.lifecycle.unmount(); }
});

test('figures that arrive while the newest refresh is still pending are not called out of date', async () => {
  const at = Date.now() - 60_000;
  let retried: (state: CacheState) => void = () => {};
  let calls = 0;
  const slot = await render(() => {
    calls++;
    if (calls === 1) return claudeState(at);
    if (calls === 2) throw new Error('Sync store unavailable');
    if (calls === 3) return new Promise<CacheState>(resolve => { retried = resolve; });
    return new Promise<CacheState>(() => {});
  });
  try {
    const chip = await slot.findByRole('button');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(calls).toBe(3);
    expect(chip.hasAttribute('data-stale')).toBe(true);
    await slot.emitRealtime('cache-changed', { threadId: 'thread-test' });
    await act(async () => { retried(claudeState(at, { invalidatedAt: Date.now() - 1000 })); await Promise.resolve(); await Promise.resolve(); });
    expect(chip.textContent).toBe('cold');
    expect(chip.hasAttribute('data-stale')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});
