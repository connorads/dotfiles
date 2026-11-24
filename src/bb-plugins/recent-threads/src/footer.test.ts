// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountChrome } from './footer.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function createFooterButton(itemId: string) {
  const button = document.createElement('button');
  button.setAttribute('data-testid', `plugin-sidebar-footer-item-recent-threads-${itemId}`);
  document.body.appendChild(button);
  return button;
}

it('marks each footer button active independently and cleans up on dispose', () => {
  let recent = false;
  let archived = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());

  const recentButton = createFooterButton('toggle');
  const archivedButton = createFooterButton('archived');
  const dispose = mountChrome(document, {
    items: { toggle: () => recent, archived: () => archived },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  expect(recentButton.getAttribute('aria-pressed')).toBe('false');
  expect(archivedButton.getAttribute('aria-pressed')).toBe('false');

  recent = true;
  notify();
  expect(recentButton.getAttribute('aria-pressed')).toBe('true');
  expect(recentButton.classList.contains('rt-active')).toBe(true);
  expect(archivedButton.getAttribute('aria-pressed')).toBe('false');

  archived = true;
  notify();
  expect(archivedButton.getAttribute('aria-pressed')).toBe('true');
  expect(archivedButton.classList.contains('rt-active')).toBe(true);

  dispose();
  for (const button of [recentButton, archivedButton]) {
    expect(button.getAttribute('aria-pressed')).toBeNull();
    expect(button.classList.contains('rt-active')).toBe(false);
  }
});

it('decorates a footer button mounted after the content script starts', async () => {
  const dispose = mountChrome(document, {
    items: { archived: () => true },
    subscribe: () => () => {},
  });

  const button = createFooterButton('archived');
  await Promise.resolve();
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.classList.contains('rt-active')).toBe(true);

  dispose();
});
