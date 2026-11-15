// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginNavPanelProps, PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract, SummaryView, ThreadView } from './contracts.ts';
import { emptyCost } from './src/report.ts';
import { setPeriod, type Days } from './src/period.ts';

afterEach(() => { act(() => setPeriod(30)); });

const day = (index: number) => new Date(Date.UTC(2026, 2, 1 + index)).toISOString().slice(0, 10);

/** A summary whose total and day count name the period it covers. */
function summary(days: Days): SummaryView {
  return {
    total: { ...emptyCost(), usd: days, requests: 1 }, models: [], threads: [], byProvider: { 'claude-code': days },
    days: Array.from({ length: days }, (_, index) => ({ day: day(index), usd: 1, byProvider: { 'claude-code': 1 } })),
    pricesAt: null, firstDay: day(0), lastDay: day(days - 1), threadInfo: {}, threadCount: 0, projects: [],
    plans: [], monthUsd: 0, firstAt: 1,
  };
}

const idle = { state: 'idle' as const, startedAt: null, finishedAt: null, error: null, files: 0, filesDone: 0, bytes: 0, bytesDone: 0, records: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Handlers = PluginRpcTestHandlers<typeof rpcContract>;
const unused = () => { throw new Error('Not used by this test.'); };

async function usagePage(summaryFor: (days: Days) => Promise<SummaryView>, extra: Partial<Handlers> = {}) {
  const app = await loadPluginApp(() => import('./app.tsx'));
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: '' } as PluginNavPanelProps, {
    rpc: { summary: ({ days }) => summaryFor(days), progress: () => idle, insights: () => ({ points: [] }), thread: unused, series: unused, ...extra },
  });
}

const eyebrow = (slot: { container: HTMLElement }) => slot.container.querySelector('.cost-eyebrow')?.textContent;

test('a slow reply for an earlier period does not replace the period picked last', async () => {
  const replies = { 30: deferred<SummaryView>(), 7: deferred<SummaryView>(), 90: deferred<SummaryView>() };
  const slot = await usagePage(days => replies[days].promise);
  try {
    await act(async () => replies[30].resolve(summary(30)));
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    act(() => setPeriod(7));
    act(() => setPeriod(90));
    // The old figures stay, dimmed and labelled with their own period, while the new one loads.
    expect(eyebrow(slot)).toBe('Last 30 days at API prices');
    expect(slot.container.querySelector('.cost-column')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => replies[90].resolve(summary(90)));
    await act(async () => replies[7].resolve(summary(7)));
    expect(eyebrow(slot)).toBe('Last 90 days at API prices');
    expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(90);
    expect(slot.container.querySelector('.cost-column')?.hasAttribute('aria-busy')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('a period that fails keeps the shown figures, says so, and retries', async () => {
  let fail = true;
  const slot = await usagePage(async days => {
    if (days === 90 && fail) throw new Error('Database busy');
    return summary(days);
  });
  try {
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    act(() => setPeriod(90));
    const alert = await slot.findByRole('alert');
    expect(alert.textContent).toContain('The last 90 days could not load: Database busy. Showing the last 30 days.');
    expect(eyebrow(slot)).toBe('Last 30 days at API prices');
    fail = false;
    fireEvent.click(slot.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 90 days at API prices'));
    expect(slot.queryByRole('alert')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('a first load that fails offers a retry that sends one request while it runs', async () => {
  let calls = 0;
  const retry = deferred<SummaryView>();
  const slot = await usagePage(() => { calls += 1; return calls === 1 ? Promise.reject(new Error('Database busy')) : retry.promise; });
  try {
    const button = await slot.findByRole('button', { name: 'Retry' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls).toBe(2);
    expect(button.textContent).toBe('Retrying…');
    await act(async () => retry.resolve(summary(30)));
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
  } finally { slot.lifecycle.unmount(); }
});

test('after a failed period, picking another says it is loading rather than repeating the old failure', async () => {
  const seven = deferred<SummaryView>();
  const slot = await usagePage(async days => {
    if (days === 90) throw new Error('Database busy.');
    return days === 7 ? seven.promise : summary(days);
  });
  try {
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    act(() => setPeriod(90));
    expect((await slot.findByRole('alert')).textContent).toContain('The last 90 days could not load: Database busy. Showing the last 30 days.');
    act(() => setPeriod(7));
    expect(slot.queryByRole('alert')).toBeNull();
    expect(slot.getByRole('status').textContent).toBe('The last 7 days are loading. Showing the last 30 days until then.');
    expect(slot.container.querySelector('.cost-column')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => seven.resolve(summary(7)));
    expect(eyebrow(slot)).toBe('Last 7 days at API prices');
    expect(slot.queryByRole('status')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('insights follow the period on screen, not one that failed', async () => {
  const asked: number[] = [];
  const slot = await usagePage(async days => {
    if (days === 90) throw new Error('Database busy');
    return summary(days);
  }, { insights: ({ days }) => { asked.push(days); return { points: [] }; } });
  try {
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    act(() => setPeriod(90));
    await slot.findByRole('alert');
    fireEvent.click(slot.getByRole('tab', { name: 'Insights' }));
    await slot.findByText('No BB threads used a model in this period.');
    expect(asked).toEqual([30]);
  } finally { slot.lifecycle.unmount(); }
});

test('retry keeps keyboard focus while it runs and after it fails again', async () => {
  const again = deferred<SummaryView>();
  let calls = 0;
  const slot = await usagePage(() => { calls += 1; return calls === 1 ? Promise.reject(new Error('Database busy')) : again.promise; });
  try {
    const button = await slot.findByRole('button', { name: 'Retry' });
    act(() => button.focus());
    fireEvent.click(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    await act(async () => again.reject(new Error('Database busy')));
    await waitFor(() => expect(button.textContent).toBe('Retry'));
    expect(document.activeElement).toBe(button);
    expect(slot.getByRole('alert').textContent).toContain('The last 30 days could not load: Database busy.');
  } finally { slot.lifecycle.unmount(); }
});

test('insights that fail say so instead of reporting no threads', async () => {
  const slot = await usagePage(async days => summary(days), { insights: () => { throw new Error('Database busy'); } });
  try {
    fireEvent.click(await slot.findByRole('tab', { name: 'Insights' }));
    expect((await slot.findByRole('alert')).textContent).toContain('Insights could not load.');
    expect(slot.queryByText('No BB threads used a model in this period.')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('the daily chart is one tab stop, and arrow keys move between days', async () => {
  const slot = await usagePage(async days => summary(days));
  try {
    await waitFor(() => expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(30));
    const columns = Array.from(slot.container.querySelectorAll<HTMLElement>('.cost-columns > li'));
    expect(columns.filter(column => column.tabIndex === 0)).toEqual([columns[29]]);
    act(() => columns[29]!.focus());
    fireEvent.keyDown(columns[29]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(columns[28]);
    fireEvent.keyDown(columns[28]!, { key: 'Home' });
    expect(document.activeElement).toBe(columns[0]);
    expect(columns.filter(column => column.tabIndex === 0)).toEqual([columns[0]]);
  } finally { slot.lifecycle.unmount(); }
});

test('the chip reads "no price" for a thread whose models have no list price', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const view: ThreadView = { ...emptyCost(), unpricedTokens: 5000, requests: 4, models: [], pricesAt: null, title: null };
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(app.threadHeaderActions[0]!,
    { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false }, { rpc: { thread: () => view, summary: unused, insights: unused, series: unused, progress: unused } });
  try {
    const chip = await slot.findByRole('button');
    expect(chip.textContent).toContain('no price');
    expect(chip.getAttribute('title')).toMatch(/^No list price · 4 requests\n/);
  } finally { slot.lifecycle.unmount(); }
});
