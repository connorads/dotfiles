// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { mountChatScroll } from './chat-scroll.ts';
import { loadPluginApp, mountPluginContentScripts } from '@get-bb/plugin-sdk/testing/app';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

function chat(pane = 'pane-1') {
  const host = document.createElement('div');
  host.setAttribute('data-split-pane-id', pane);
  host.setAttribute('data-focused', 'true');
  host.innerHTML = '<div data-thread-window><div data-page-scroll-viewport class="thread-scrollbar"><p>Example conversation</p><button>Copy</button></div></div>';
  document.body.append(host);
  return host.querySelector<HTMLElement>('[data-page-scroll-viewport]')!;
}

const redraw = () => new Promise(resolve => setTimeout(resolve, 0));

test('split chats have a named keyboard target without stealing focus', () => {
  const first = chat();
  const second = chat('pane-2');
  const button = first.querySelector('button')!;
  button.focus();
  dispose = mountChatScroll(document);
  for (const [index, viewport] of [first, second].entries()) {
    expect(viewport.tabIndex).toBe(0);
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe(`Conversation ${index + 1}`);
    expect(viewport.hasAttribute('data-fork-chat-scroll')).toBe(true);
  }
  expect(document.activeElement).toBe(button);
  second.focus();
  expect(document.activeElement).toBe(second);
});

test('conversation names stay distinct when a pane is replaced or removed', async () => {
  const first = chat();
  const second = chat('pane-2');
  dispose = mountChatScroll(document);
  first.closest('[data-split-pane-id]')!.remove();
  await redraw();
  expect(second.getAttribute('aria-label')).toBe('Conversation 1');
  const next = chat('pane-3');
  await redraw();
  expect(next.getAttribute('aria-label')).toBe('Conversation 2');
});

test('navigation decorates replacement chats and restores detached viewports', async () => {
  const previous = chat();
  dispose = mountChatScroll(document);
  previous.closest('[data-split-pane-id]')!.remove();
  const next = chat();
  await redraw();
  expect(next.tabIndex).toBe(0);
  expect(previous.hasAttribute('tabindex')).toBe(false);
  expect(previous.hasAttribute('data-fork-chat-scroll')).toBe(false);
});

test('unrelated scroll areas and editable controls retain their behaviour', () => {
  document.body.innerHTML = '<div data-page-scroll-viewport class="thread-scrollbar"></div><div data-split-pane-id="pane-1"><div data-page-scroll-viewport></div></div>';
  const single = chat('single');
  single.closest('[data-split-pane-id]')!.removeAttribute('data-focused');
  const viewport = chat();
  viewport.innerHTML += '<textarea>Example draft</textarea>';
  dispose = mountChatScroll(document);
  expect(document.querySelectorAll('[data-fork-chat-scroll]')).toHaveLength(1);
  const editor = viewport.querySelector('textarea')!;
  editor.focus();
  const key = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  editor.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(editor);
});

test('native accessibility attributes survive mounting and disposal', () => {
  const viewport = chat();
  viewport.setAttribute('tabindex', '-1');
  viewport.setAttribute('role', 'log');
  viewport.setAttribute('aria-labelledby', 'example-heading');
  dispose = mountChatScroll(document);
  expect(viewport.getAttribute('tabindex')).toBe('-1');
  expect(viewport.getAttribute('role')).toBe('log');
  expect(viewport.hasAttribute('aria-label')).toBe(false);
  dispose();
  expect(viewport.getAttribute('aria-labelledby')).toBe('example-heading');
});

test('disposal removes owned attributes and stops observing without undoing native updates', async () => {
  const viewport = chat();
  dispose = mountChatScroll(document);
  viewport.setAttribute('aria-label', 'Native conversation label');
  dispose();
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  expect(viewport.hasAttribute('role')).toBe(false);
  expect(viewport.hasAttribute('data-fork-chat-scroll')).toBe(false);
  expect(viewport.getAttribute('aria-label')).toBe('Native conversation label');
  const next = chat('pane-2');
  await redraw();
  expect(next.hasAttribute('tabindex')).toBe(false);
});


test('leaving the split restores attributes on the retained chat viewport', async () => {
  const viewport = chat();
  dispose = mountChatScroll(document);
  viewport.closest('[data-split-pane-id]')!.removeAttribute('data-focused');
  await redraw();
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  expect(viewport.hasAttribute('data-fork-chat-scroll')).toBe(false);
});


test('the registered Fork content script mounts and disposes the viewport decoration', async () => {
  const viewport = chat();
  const app = await loadPluginApp(() => import('./app.tsx'));
  const mounted = await mountPluginContentScripts(app, { pluginId: 'fork' });
  try {
    expect(mounted.inspection.mountedIds).toContain('chat-scroll');
    expect(viewport.tabIndex).toBe(0);
  } finally {
    await mounted.lifecycle.dispose();
  }
  expect(viewport.hasAttribute('tabindex')).toBe(false);
  expect(viewport.hasAttribute('data-fork-chat-scroll')).toBe(false);
});
