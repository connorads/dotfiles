// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountChrome } from './footer.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function createFooterButton() {
  const button = document.createElement('button');
  button.setAttribute('data-testid', 'plugin-sidebar-footer-item-recent-threads-toggle');
  document.body.appendChild(button);
  return button;
}

it('marks the footer button active when chronological mode is on and cleans up on dispose', () => {
  let active = false;
  const listeners = new Set<() => void>();
  const setActive = (next: boolean) => {
    active = next;
    listeners.forEach(listener => listener());
  };

  const button = createFooterButton();
  const dispose = mountChrome(document, {
    active: () => active,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.classList.contains('rt-active')).toBe(false);

  setActive(true);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.classList.contains('rt-active')).toBe(true);

  dispose();
  expect(button.getAttribute('aria-pressed')).toBeNull();
  expect(button.classList.contains('rt-active')).toBe(false);
});

it('decorates a footer button mounted after the content script starts', async () => {
  const dispose = mountChrome(document, {
    active: () => true,
    subscribe: () => () => {},
  });

  const button = createFooterButton();
  await Promise.resolve();
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.classList.contains('rt-active')).toBe(true);

  dispose();
});
