// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountTimestamps } from './labels';
import { setTimes } from './store';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); setTimes([]); document.body.replaceChildren(); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it('shows recorded times without requiring message actions and leaves existing times alone', () => {
  document.body.innerHTML = '<div data-timeline-row-id="a"><div data-message-column>Assistant</div></div><div data-timeline-row-id="b"><div data-message-column>Automation<time>12:00</time></div></div><div data-timeline-row-id="unknown"><div data-message-column>Unknown</div></div>';
  setTimes([{ id: 'a', timestamp: Date.UTC(2026, 9, 19, 12, 34), role: 'assistant' }, { id: 'b', timestamp: 1, role: 'user' }]);
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
  setTimes([{ id: 'a', timestamp: 1, role: 'user' }]);
  expect(document.querySelector('.bb-message-time')?.getAttribute('data-role')).toBe('user');
  document.querySelector('[data-message-column]')!.innerHTML = 'Redrawn';
  await settle();
  expect(document.querySelectorAll('.bb-message-time')).toHaveLength(1);
  setTimes([]);
  expect(document.querySelector('.bb-message-time')).toBeNull();
  dispose();
  setTimes([{ id: 'a', timestamp: 1, role: 'user' }]);
  expect(document.querySelector('.bb-message-time')).toBeNull();
});
