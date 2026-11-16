// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from '@get-bb/plugin-sdk/testing/app';
import type { PluginNavPanelProps, PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract, SummaryView, ThreadView } from './contracts.ts';
import { emptyCost } from './src/report.ts';
import { setGrouped, setPeriod, type Days } from './src/period.ts';

afterEach(() => { act(() => { setPeriod(30); setGrouped(false); }); });

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

test('the page body offers the sub-thread switch for narrow headers and names the grouping it shows', async () => {
  const asked: boolean[] = [];
  const slot = await usagePage(async days => summary(days), { summary: ({ days, group }) => { asked.push(group === true); return summary(days); } });
  try {
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    const body = slot.getByRole('radiogroup', { name: 'Sub-threads' });
    fireEvent.click(within(body).getByRole('radio', { name: 'With sub-threads' }));
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days with sub-threads at API prices'));
    expect(within(body).getByRole('radio', { name: 'With sub-threads' }).getAttribute('aria-checked')).toBe('true');
    expect(asked).toEqual([false, true]);
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

test('the chart tooltip stays on the focused day when a new period replaces the columns', async () => {
  const ninety = deferred<SummaryView>();
  const slot = await usagePage(days => days === 90 ? ninety.promise : Promise.resolve(summary(days)));
  try {
    await waitFor(() => expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(30));
    const last = slot.container.querySelector<HTMLElement>('.cost-columns > li:last-child')!;
    act(() => last.focus());
    const tip = () => slot.container.querySelector('.cost-tooltip strong')?.textContent;
    const before = tip();
    act(() => setPeriod(90));
    // Both periods end on the same day, so the focused last day becomes column 90 of 90.
    const longer = summary(90);
    await act(async () => ninety.resolve({ ...longer, days: longer.days.map((value, index) => ({ ...value, day: day(index - 60) })), lastDay: day(29) }));
    const columns = Array.from(slot.container.querySelectorAll('.cost-columns > li'));
    expect(columns).toHaveLength(90);
    expect(tip()).toBe(before);
    expect(columns.findIndex(column => column.hasAttribute('data-active'))).toBe(89);
  } finally { slot.lifecycle.unmount(); }
});

test('a retry that fails again says so, and a retry that succeeds leaves focus in the page', async () => {
  let calls = 0;
  const slot = await usagePage(async days => {
    calls += 1;
    if (calls <= 3) throw new Error('Database busy');
    return summary(days);
  });
  try {
    const button = await slot.findByRole('button', { name: 'Retry' });
    act(() => button.focus());
    fireEvent.click(button);
    await waitFor(() => expect(slot.getByRole('alert').textContent).toContain('Still failing after 1 retry.'));
    fireEvent.click(button);
    await waitFor(() => expect(slot.getByRole('alert').textContent).toContain('Still failing after 2 retries.'));
    fireEvent.click(button);
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
    await waitFor(() => expect(document.activeElement).toBe(slot.container.querySelector('.cost-column')));
  } finally { slot.lifecycle.unmount(); }
});

test('a thread card retry that succeeds moves focus to the card', async () => {
  let fail = true;
  const view: ThreadView = { ...emptyCost(), usd: 4.2, requests: 3, models: [], pricesAt: null, title: 'Plan the seed catalogue' };
  const app = await loadPluginApp(() => import('./app.tsx'));
  const slot = renderSlot<PluginNavPanelProps, typeof rpcContract>(app.navPanels[0]!, { subPath: 'thread/thread-test' } as PluginNavPanelProps, {
    rpc: { summary: ({ days }) => summary(days), progress: () => idle, insights: () => ({ points: [] }), series: () => ({ points: [], requests: 0, growth: null }),
      thread: () => { if (fail) throw new Error('Database busy'); return view; } },
  });
  try {
    const card = await waitFor(() => { const found = slot.container.querySelector<HTMLElement>('.cost-focus [role="alert"]'); expect(found).not.toBeNull(); return found!; });
    const button = within(card).getByRole('button', { name: 'Retry' });
    act(() => button.focus());
    fail = false;
    fireEvent.click(button);
    await slot.findByText('Plan the seed catalogue');
    await waitFor(() => expect(document.activeElement).toBe(slot.container.querySelector('.cost-focus')));
  } finally { slot.lifecycle.unmount(); }
});

test('a retry that a realtime refresh supersedes does not report a failure', async () => {
  const replies: ReturnType<typeof deferred<SummaryView>>[] = [];
  const slot = await usagePage(() => { const reply = deferred<SummaryView>(); replies.push(reply); return reply.promise; });
  try {
    await act(async () => replies[0]!.reject(new Error('Database busy')));
    const button = await slot.findByRole('button', { name: 'Retry' });
    fireEvent.click(button);
    await slot.emitRealtime('usage-changed', {});
    await act(async () => replies[1]!.reject(new Error('Database busy')));
    expect(slot.getByRole('alert').textContent).not.toContain('Still failing');
    await act(async () => replies[2]!.resolve(summary(30)));
    await waitFor(() => expect(eyebrow(slot)).toBe('Last 30 days at API prices'));
  } finally { slot.lifecycle.unmount(); }
});

test('two clicks in one task send one retry', async () => {
  let calls = 0;
  const slot = await usagePage(() => { calls += 1; return calls === 1 ? Promise.reject(new Error('Database busy')) : new Promise<SummaryView>(() => {}); });
  try {
    const button = await slot.findByRole('button', { name: 'Retry' });
    act(() => { button.click(); button.click(); });
    expect(calls).toBe(2);
  } finally { slot.lifecycle.unmount(); }
});

test('the retry focus home stops taking focus once focus leaves it', async () => {
  let calls = 0;
  const slot = await usagePage(async days => { calls += 1; if (calls === 1) throw new Error('Database busy'); return summary(days); });
  try {
    const button = await slot.findByRole('button', { name: 'Retry' });
    act(() => button.focus());
    fireEvent.click(button);
    const column = slot.container.querySelector<HTMLElement>('.cost-column')!;
    await waitFor(() => expect(document.activeElement).toBe(column));
    act(() => column.blur());
    expect(column.hasAttribute('tabindex')).toBe(false);
  } finally { slot.lifecycle.unmount(); }
});

test('a focused chart day that a period drops does not bring its tooltip back later', async () => {
  const slot = await usagePage(async days => summary(days));
  try {
    await waitFor(() => expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(30));
    // Fixture periods start on the same day, so the 7-day columns lack the 30th day.
    act(() => slot.container.querySelector<HTMLElement>('.cost-columns > li:last-child')!.focus());
    expect(slot.container.querySelector('.cost-tooltip')).not.toBeNull();
    act(() => setPeriod(7));
    await waitFor(() => expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(7));
    act(() => setPeriod(30));
    await waitFor(() => expect(slot.container.querySelectorAll('.cost-columns > li')).toHaveLength(30));
    expect(slot.container.querySelector('.cost-tooltip')).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

test('the chip keeps its estimate when a refresh fails, and an older reply never replaces a newer one', async () => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const view = (usd: number): ThreadView => ({ ...emptyCost(), usd, requests: 4, models: [], pricesAt: null, title: null });
  const replies: ReturnType<typeof deferred<ThreadView>>[] = [];
  const slot = renderSlot<PluginThreadHeaderActionProps, typeof rpcContract>(app.threadHeaderActions[0]!,
    { threadId: 'thread-test', projectId: 'project-test', isCompactViewport: false },
    { rpc: { thread: () => { const reply = deferred<ThreadView>(); replies.push(reply); return reply.promise; }, summary: unused, insights: unused, series: unused, progress: unused } });
  try {
    await waitFor(() => expect(replies).toHaveLength(1));
    await act(async () => replies[0]!.resolve(view(4.2)));
    expect((await slot.findByRole('button')).textContent).toContain('$4.20');
    await slot.emitRealtime('usage-changed', {});
    await act(async () => replies[1]!.reject(new Error('Database busy')));
    expect(slot.getByRole('button').textContent).toContain('$4.20');
    await slot.emitRealtime('usage-changed', {});
    await slot.emitRealtime('usage-changed', {});
    await act(async () => replies[3]!.resolve(view(6.5)));
    await act(async () => replies[2]!.resolve(view(5.1)));
    expect(slot.getByRole('button').textContent).toContain('$6.50');
  } finally { slot.lifecycle.unmount(); }
});
