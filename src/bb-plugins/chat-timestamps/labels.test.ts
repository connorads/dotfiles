// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountTimestamps } from './labels';
import { setTimes } from './store';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); setTimes([]); document.body.replaceChildren(); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('shows recorded times without requiring message actions and leaves existing times alone', () => {
  document.body.innerHTML = '<div data-timeline-row-id="a"><div data-message-column>Assistant</div></div><div data-timeline-row-id="b"><div data-message-column>Automation<time>12:00</time></div></div><div data-timeline-row-id="unknown"><div data-message-column>Unknown</div></div>';
  setTimes([{ id: 'a', timestamp: Date.UTC(2026, 9, 19, 12, 34), role: 'assistant', previousTimestamp: null }, { id: 'b', timestamp: 1, role: 'user', previousTimestamp: null }]);
  dispose = mountTimestamps(document);
  expect(document.querySelectorAll('.bb-message-time')).toHaveLength(1);
  const time = document.querySelector<HTMLTimeElement>('.bb-message-time')!;
  expect(time.dateTime).toBe('2026-10-19T12:34:00.000Z');
  expect(time.title).toContain('2026');
  expect(time.textContent).not.toBe('');
  dispose();
  expect(document.querySelectorAll('.bb-message-time')).toHaveLength(0);
  expect(document.querySelectorAll('time')).toHaveLength(1);
});

it('decorates streamed rows, updates metadata, and removes stale labels on navigation', async () => {
  dispose = mountTimestamps(document);
  document.body.innerHTML = '<div data-timeline-row-id="a"><div data-message-column>Message</div></div>';
  await settle();
  expect(document.querySelector('.bb-message-time')).toBeNull();
  setTimes([{ id: 'a', timestamp: 1, role: 'user', previousTimestamp: null }]);
  expect(document.querySelector('.bb-message-time')?.getAttribute('datetime')).toBe('1970-01-01T00:00:00.001Z');
  document.querySelector('[data-message-column]')!.innerHTML = 'Redrawn';
  await settle();
  expect(document.querySelectorAll('.bb-message-time')).toHaveLength(1);
  setTimes([]);
  expect(document.querySelector('.bb-message-time')).toBeNull();
  dispose();
  setTimes([{ id: 'a', timestamp: 1, role: 'user', previousTimestamp: null }]);
  expect(document.querySelector('.bb-message-time')).toBeNull();
});

it('marks real pauses and date changes without inventing gaps from missing DOM rows', () => {
  const start = new Date(2026, 9, 19, 12).getTime();
  document.body.innerHTML = ['first', 'near', 'gap', 'unknown', 'midnight'].map(id =>
    `<div data-timeline-row-id="${id}"><div data-message-column>${id}</div></div>`).join('');
  setTimes([
    { id: 'first', timestamp: start, previousTimestamp: null, role: 'user' },
    { id: 'near', timestamp: start + 60000, previousTimestamp: start, role: 'assistant' },
    { id: 'gap', timestamp: start + 660000, previousTimestamp: start + 60000, role: 'assistant' },
    { id: 'unknown', timestamp: start + 9999999, role: 'assistant' },
    { id: 'midnight', timestamp: new Date(2026, 9, 20, 0, 1).getTime(), previousTimestamp: new Date(2026, 9, 19, 23, 59).getTime(), role: 'user' },
  ]);
  dispose = mountTimestamps(document);
  expect(Array.from(document.querySelectorAll('.bb-message-time')).map(e => e.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id'))).toEqual(['first', 'gap', 'midnight']);
  expect(document.querySelector('[data-timeline-row-id="first"] [data-message-column]')?.firstChild?.nodeName).toBe('TIME');
  // Removing an intervening rendered message must not make a new gap.
  document.querySelector('[data-timeline-row-id="first"]')?.remove();
  expect(document.querySelector('[data-timeline-row-id="near"] time')).toBeNull();
});

it('places exact times after native actions even without a known gap, and cleans up redraws', async () => {
  document.body.innerHTML = '<div data-timeline-row-id="a"><div data-message-column><div class="actions"><button aria-label="Message actions">Menu</button></div></div></div>';
  setTimes([{ id: 'a', timestamp: 1000, role: 'assistant' }]);
  dispose = mountTimestamps(document);
  const actions = document.querySelector('.actions')!;
  expect(actions.lastElementChild?.classList.contains('bb-message-exact')).toBe(true);
  expect(actions.querySelector('time')?.dateTime).toBe('1970-01-01T00:00:01.000Z');
  expect(document.querySelector('.bb-message-time')).toBeNull();
  actions.innerHTML = '<button aria-label="Message actions">Replacement</button>';
  await settle();
  expect(actions.querySelectorAll('.bb-message-exact')).toHaveLength(1);
  setTimes([{ id: 'a', timestamp: 2000, role: 'assistant' }]);
  expect(actions.querySelector('time')?.dateTime).toBe('1970-01-01T00:00:02.000Z');
  dispose();
  expect(actions.querySelector('time')).toBeNull();
  expect(actions.querySelector('button')?.textContent).toBe('Replacement');
});
