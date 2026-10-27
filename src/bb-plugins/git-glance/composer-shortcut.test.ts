// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountComposerShortcut } from './composer-shortcut.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; });

it('opens the picked project on macOS Option+G without inserting ©', () => {
  const opened: string[] = [];
  dispose = mountComposerShortcut(window, () => 'project:p', subject => opened.push(subject));
  const event = new KeyboardEvent('keydown', { key: '©', code: 'KeyG', altKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const repeated = new KeyboardEvent('keydown', { key: '©', code: 'KeyG', altKey: true, repeat: true, bubbles: true, cancelable: true });
  window.dispatchEvent(repeated);
  expect(repeated.defaultPrevented).toBe(true);
  const unidentified = new KeyboardEvent('keydown', { key: '©', code: 'Unidentified', altKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(unidentified);
  expect(unidentified.defaultPrevented).toBe(true);
  expect(opened).toEqual(['project:p', 'project:p']);
});

it('leaves other keys and missing projects to the editor, then disposes', () => {
  const opened: string[] = [];
  let subject: string | null = null;
  dispose = mountComposerShortcut(window, () => subject, value => opened.push(value));
  const key = () => new KeyboardEvent('keydown', { key: '©', code: 'KeyG', altKey: true, bubbles: true, cancelable: true });
  const unselected = key(); window.dispatchEvent(unselected);
  expect(unselected.defaultPrevented).toBe(false);
  subject = 'project:p';
  const modified = new KeyboardEvent('keydown', { key: '©', code: 'KeyG', altKey: true, metaKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);
  dispose(); dispose = undefined;
  const after = key(); window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  expect(opened).toEqual([]);
});
