// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { formatElapsed, mountWorkflowTimers, setSource, type Call } from './timers';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; setSource(null); document.body.replaceChildren(); });
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
