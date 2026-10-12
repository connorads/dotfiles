// @vitest-environment jsdom
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { loadPluginApp, renderSlot, type RenderedSlot } from '@get-bb/plugin-sdk/testing/app';

let slot: RenderedSlot | undefined;
afterEach(() => { slot?.lifecycle.unmount(); slot = undefined; document.body.innerHTML = ''; });

async function render() {
  const app = await loadPluginApp(() => import('./app.tsx'));
  const registration = app.appOverlays[0];
  if (!registration) throw new Error('Composer keys overlay missing');
  slot = renderSlot(registration, {});
}

function composer() {
  document.body.innerHTML = '<form data-promptbox><div contenteditable="true"></div></form>';
  return document.querySelector<HTMLElement>('[contenteditable]')!;
}

function question() {
  document.body.innerHTML = '<textarea placeholder="Type your own answer…"></textarea>';
  return document.querySelector('textarea')!;
}

function record(target: HTMLElement) {
  const seen: KeyboardEvent[] = [];
  target.addEventListener('keydown', event => seen.push(event));
  return seen;
}

const press = (target: HTMLElement, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));

test('Alt+Enter in the composer becomes Shift+Enter', async () => {
  await render();
  const editor = composer();
  const seen = record(editor);
  expect(press(editor, { altKey: true })).toBe(false);
  expect(seen.map(e => [e.shiftKey, e.altKey])).toEqual([[true, false]]);
});

test('plain Enter in the composer passes through', async () => {
  await render();
  const editor = composer();
  const seen = record(editor);
  press(editor, {});
  expect(seen.map(e => [e.shiftKey, e.altKey, e.metaKey])).toEqual([[false, false, false]]);
});

test('Enter in a question answer becomes Cmd+Enter', async () => {
  await render();
  const box = question();
  const seen = record(box);
  expect(press(box, {})).toBe(false);
  expect(seen.map(e => [e.metaKey, e.shiftKey])).toEqual([[true, false]]);
});

test('Alt+Enter in a question answer inserts a newline', async () => {
  await render();
  const box = question();
  const insert = vi.fn(() => true);
  Object.assign(document, { execCommand: insert });
  const seen = record(box);
  expect(press(box, { altKey: true })).toBe(false);
  expect(insert).toHaveBeenCalledWith('insertText', false, '\n');
  expect(seen).toEqual([]);
});

test('IME composition and other fields pass through', async () => {
  await render();
  const box = question();
  const seen = record(box);
  press(box, { isComposing: true });
  document.body.insertAdjacentHTML('beforeend', '<textarea id="other"></textarea>');
  const other = document.querySelector<HTMLElement>('#other')!;
  const otherSeen = record(other);
  press(other, { altKey: true });
  expect(seen.map(e => e.metaKey)).toEqual([false]);
  expect(otherSeen.map(e => e.altKey)).toEqual([true]);
});

// BB's composer blurs itself and prevents default on an Escape nothing else claims.
function running({ bbBlurs = true } = {}) {
  document.body.innerHTML = '<form data-promptbox><div contenteditable="true" tabindex="0"></div>'
    + '<button type="button" aria-label="Stop run"></button></form>';
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
  editor.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (bbBlurs) editor.blur();
  });
  const stop = vi.fn();
  document.querySelector('button')!.addEventListener('click', stop);
  editor.focus();
  return { editor, stop };
}

const escape = (target: HTMLElement, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));

test('Escape in the composer stops a running agent and keeps focus', async () => {
  await render();
  const { editor, stop } = running();
  escape(editor);
  expect(stop).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(editor);
});

test('Escape that BB used for something else does not stop the agent', async () => {
  await render();
  const { editor, stop } = running({ bbBlurs: false });
  escape(editor);
  expect(stop).not.toHaveBeenCalled();
});

test('Escape outside the composer or with modifiers does not stop the agent', async () => {
  await render();
  const { editor, stop } = running();
  document.body.insertAdjacentHTML('beforeend', '<input id="elsewhere">');
  escape(document.querySelector<HTMLElement>('#elsewhere')!);
  editor.focus();
  escape(editor, { shiftKey: true });
  editor.focus();
  escape(editor, { isComposing: true });
  expect(stop).not.toHaveBeenCalled();
});

test('Escape with no run in progress leaves BB blurring the composer', async () => {
  await render();
  const { editor } = running();
  document.querySelector('button')!.remove();
  escape(editor);
  expect(document.activeElement).not.toBe(editor);
});

// BB blurs an idle composer on Escape, so the second press lands on <body>.
function idleThread({ draft = '' } = {}) {
  document.body.innerHTML = `<form data-promptbox><div contenteditable="true" tabindex="0">${draft}</div></form>`;
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); editor.blur(); }
  });
  const opened = vi.fn();
  window.addEventListener('composer-keys:rewind', opened);
  onTestFinished(() => window.removeEventListener('composer-keys:rewind', opened));
  editor.focus();
  return { editor, opened };
}

test('double Escape in an idle empty composer opens the rewind picker', async () => {
  await render();
  const { editor, opened } = idleThread();
  escape(editor);
  escape(document.body);
  expect(opened).toHaveBeenCalledOnce();
});

test('single Escape or slow double Escape does not open the picker', async () => {
  await render();
  vi.useFakeTimers();
  try {
    const { editor, opened } = idleThread();
    escape(editor);
    vi.advanceTimersByTime(600);
    escape(document.body);
    expect(opened).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('double Escape with a draft does not open the picker', async () => {
  await render();
  const { editor, opened } = idleThread({ draft: 'half-typed' });
  escape(editor);
  escape(document.body);
  expect(opened).not.toHaveBeenCalled();
});

test('the Escape that stops a run does not start a double Escape', async () => {
  await render();
  const { editor, stop } = running();
  const opened = vi.fn();
  window.addEventListener('composer-keys:rewind', opened);
  onTestFinished(() => window.removeEventListener('composer-keys:rewind', opened));
  escape(editor);
  escape(document.body);
  expect(stop).toHaveBeenCalledOnce();
  expect(opened).not.toHaveBeenCalled();
});


test.each(['q', 'Q'])('%s closes the focused rewind list and restores focus', async key => {
  const app = await loadPluginApp(() => import('./app.tsx'));
  slot = renderSlot(app.appOverlays[0], {}, {
    context: { threadId: 'thread-test' },
    sdk: { threads: { events: { list: async () => [] } } },
  });
  const origin = document.createElement('button');
  document.body.append(origin); origin.focus();
  act(() => { window.dispatchEvent(new Event('composer-keys:rewind')); });
  const list = await slot.findByRole('listbox', { name: 'Your messages' });
  expect(document.activeElement).toBe(list);
  fireEvent.keyDown(list, { key, ctrlKey: true });
  expect(slot.getByRole('dialog', { name: 'Rewind' })).toBeTruthy();
  fireEvent.keyDown(list, { key });
  await waitFor(() => expect(slot?.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(origin);
});
