// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { hideNativePicker, NATIVE_PICKER } from './hide-native.ts';

// Markup captured from BB 0.49's bundled composer: native trigger, then plugin actions in the next row.
const composer = `
<div data-promptbox-standard-actions=""><button aria-label="Prompt actions"></button>
  <button type="button" aria-label="Provider, model and reasoning (⇧ ⌘ M)" aria-haspopup="dialog"><span>6.1-Sol</span></button></div>
<div data-promptbox-standard-actions=""><div data-plugin-composer-action-plugin="claude-profiles"><div data-bb-plugin-root="">
  <button type="button" aria-label="Switch model: GPT-6.1-Sol, medium"></button></div></div>
  <button aria-label="Start voice input"></button></div>`;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; });

test('the rule matches only BB\'s native model trigger, with or without its shortcut hint', () => {
  document.body.innerHTML = composer + `<div data-promptbox-standard-actions=""><button aria-label="Provider, model and reasoning"></button></div>`;
  const matched = Array.from(document.querySelectorAll(NATIVE_PICKER)).map(element => element.getAttribute('aria-label'));
  expect(matched).toEqual(['Provider, model and reasoning (⇧ ⌘ M)', 'Provider, model and reasoning']);
});

test('mounting adds one owned style rule and disposal removes it', () => {
  dispose = hideNativePicker(document);
  hideNativePicker(document)();
  const styles = document.head.querySelectorAll('style[data-agent-switcher="hide-native-picker"]');
  expect(styles).toHaveLength(1);
  expect(styles[0]?.textContent).toContain(NATIVE_PICKER);
  dispose();
  dispose = undefined;
  expect(document.head.querySelectorAll('style[data-agent-switcher]')).toHaveLength(0);
});
