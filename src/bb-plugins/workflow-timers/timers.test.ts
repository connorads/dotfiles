// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { formatElapsed, mountWorkflowTimers, setSource, type Call } from './timers';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; setSource(null); document.body.replaceChildren(); vi.useRealTimers(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const NOW = 10_000_000;
const row = (label: string, duration = '') => `<button><span title="${label}">${label}</span><span class="ml-auto"><span title="claude-code · opus">claude-code · opus</span>${duration}</span></button>`;
const preview = (rows: string) => `<div data-timeline-row-id="parent:assistant:1"><div data-bb-plugin="workflows"><section aria-label="Workflow" title='::workflow-preview{run="wfr_one"}'>${rows}</section></div></div>`;
const call = (label: string, over: Partial<Call> = {}): Call => ({ label, status: 'running', startedAt: NOW - 1503_000, childThreadId: `thr_${label}`, ...over });
const timers = () => Array.from(document.querySelectorAll<HTMLElement>('.wt-live'));

function mount(calls: Call[], lastActivity: Record<string, number | null> = {}) {
  setSource({ calls: async () => calls, lastActivity: async threadId => lastActivity[threadId] ?? null });
  dispose = mountWorkflowTimers(document, () => NOW);
}

test('formats elapsed time like finished workflow durations', () => {
  expect([0, 59_400, 60_000, 2181_000, 7500_000].map(formatElapsed)).toEqual(['0s', '59s', '1m00s', '36m21s', '125m00s']);
});

test('shows elapsed time on a running row and stays quiet while the worker is active', async () => {
  document.body.innerHTML = preview(row('P6'));
  mount([call('P6')], { thr_P6: NOW - 20_000 });
  await settle();
  const [live] = timers();
  expect(live.querySelector('.wt-elapsed')?.textContent).toBe('25m03s');
  expect(live.querySelector('.wt-quiet')?.textContent).toBe('');
  expect(live.hasAttribute('data-quiet')).toBe(false);
  expect(live.title).toMatch(/^Started .+ · last thread event .+$/);
});

test('flags quiet and stalled workers by time since their last thread event', async () => {
  document.body.innerHTML = preview(row('A') + row('B'));
  mount([call('A'), call('B')], { thr_A: NOW - 6.5 * 60_000, thr_B: NOW - 19 * 60_000 });
  await settle();
  expect(timers().map(live => [live.dataset.quiet, live.querySelector('.wt-quiet')?.textContent])).toEqual([['warn', 'quiet 6m'], ['stall', 'quiet 19m']]);
});

test('omits finished, natively timed, ambiguous and unknown rows', async () => {
  document.body.innerHTML = preview(row('Done') + row('Native', '<span class="tabular-nums">36m21s</span>') + row('Twin') + row('Unknown'));
  mount([call('Done', { status: 'succeeded' }), call('Native'), call('Twin'), call('Twin')]);
  await settle();
  expect(timers()).toEqual([]);
});

test('removes the timer when the row finishes and on disposal', async () => {
  document.body.innerHTML = preview(row('P6'));
  mount([call('P6')]);
  await settle();
  expect(timers()).toHaveLength(1);
  document.querySelector('span.ml-auto')!.insertAdjacentHTML('beforeend', '<span class="tabular-nums">25m03s</span>');
  await settle();
  expect(timers()).toEqual([]);
  document.body.innerHTML = preview(row('P6'));
  await settle();
  expect(timers()).toHaveLength(1);
  dispose!(); dispose = undefined;
  expect(timers()).toEqual([]);
});


test('provides native keyboard and touch disclosure outside the workflow row button', async () => {
  document.body.innerHTML = preview(row('P6'));
  mount([call('P6')], { thr_P6: NOW - 20_000 });
  await settle();
  const details = document.querySelector('details');
  expect(details?.querySelector('summary')?.textContent).toBe('Timing details for P6');
  expect(details?.textContent).toMatch(/Started .+ · last thread event .+/);
  expect(details?.closest('button')).toBeNull();
  dispose!(); dispose = undefined;
  expect(document.querySelector('details')).toBeNull();
});

test('marks quiet time unknown when the worker event read fails instead of looking healthy', async () => {
  document.body.innerHTML = preview(row('P6'));
  setSource({ calls: async () => [call('P6')], lastActivity: async () => { throw new Error('offline'); } });
  dispose = mountWorkflowTimers(document, () => NOW);
  await settle(); await settle();
  const [live] = timers();
  expect(live.dataset.quiet).toBe('unknown');
  expect(live.querySelector('.wt-quiet')?.textContent).toBe('quiet ?');
  expect(document.querySelector('details p')?.textContent).toMatch(/last thread event could not be read, retrying$/);
});

test('retries a read that never settles', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = preview(row('P6'));
  let reads = 0;
  setSource({ calls: async () => [call('P6')], lastActivity: () => { reads += 1; return reads === 1 ? new Promise(() => {}) : Promise.resolve(NOW - 19 * 60_000); } });
  dispose = mountWorkflowTimers(document, () => NOW);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reads).toBe(2);
  expect(timers()[0].querySelector('.wt-quiet')?.textContent).toBe('quiet 19m');
});

test('keeps an open disclosure and its focus when the row is re-rendered', async () => {
  document.body.innerHTML = preview(row('P6'));
  mount([call('P6')], { thr_P6: NOW - 20_000 });
  await settle();
  const details = document.querySelector('details')!;
  details.open = true;
  details.querySelector('summary')!.focus();
  const old = document.querySelector('section button')!;
  old.replaceWith(Object.assign(document.createElement('div'), { innerHTML: row('P6') }).firstElementChild!);
  await settle();
  expect(document.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(details.querySelector('summary'));
  expect(details.previousElementSibling?.querySelector('.wt-live')).not.toBeNull();
});

test('moves focus to the agent row when its open disclosure goes away on finish', async () => {
  document.body.innerHTML = preview(row('P6'));
  mount([call('P6')], { thr_P6: NOW - 20_000 });
  await settle();
  document.querySelector('summary')!.focus();
  document.querySelector('span.ml-auto')!.insertAdjacentHTML('beforeend', '<span class="tabular-nums">25m03s</span>');
  await settle();
  expect(document.querySelector('details')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('section button'));
});

test('omits rows whose label repeats in the rendered preview', async () => {
  document.body.innerHTML = preview(row('P6') + row('P6'));
  mount([call('P6')]);
  await settle();
  expect(timers()).toEqual([]);
});
