// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { captureChoice, type ChoiceCapture, type ChoicePicker } from './choice-target.ts';

let context = 'thread:one';
let calls = 0;
function question(multiple = false) {
  const pane = document.createElement('section');
  pane.dataset.splitPaneId = 'main';
  pane.dataset.focused = 'true';
  pane.innerHTML =
    '<div tabindex="-1"><fieldset><legend>Choose a change</legend><button aria-pressed="false">Small patch<kbd>1</kbd></button><button aria-pressed="false">Full rewrite<kbd>2</kbd></button><button aria-pressed="false">Other<kbd>3</kbd></button></fieldset></div><textarea aria-label="Composer"></textarea>';
  document.body.append(pane);
  const group = pane.querySelector('fieldset')!;
  const buttons = Array.from(group.querySelectorAll('button'));
  buttons.forEach((button, index) =>
    button.addEventListener('click', () => {
      calls++;
      const selected = button.getAttribute('aria-pressed') === 'true';
      if (!multiple) buttons.forEach((item) => item.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', String(multiple ? !selected : true));
      group.querySelector('textarea')?.remove();
      if (index === 2) group.append(document.createElement('textarea'));
    }),
  );
  pane.querySelector('textarea')!.focus();
  return { pane, group, buttons };
}
function capture(picker?: ChoicePicker, monitor?: HTMLElement) {
  return captureChoice(document, () => context, picker, monitor);
}
function apply(target: ChoiceCapture, number: number) {
  if (!target.ok) throw new Error(target.reason);
  return target.apply(number);
}
beforeEach(() => {
  context = 'thread:one';
  calls = 0;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [{ width: 100, height: 30 }] as unknown as DOMRectList,
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('selects from composer focus, restores native form focus, and consumes once', async () => {
  const { group, buttons } = question();
  const target = capture();
  expect(await apply(target, 2)).toMatchObject({ ok: true, outcome: 'completed', message: 'Selected Full rewrite.' });
  expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(group.parentElement);
  expect(await apply(target, 1)).toMatchObject({ ok: false });
  expect(calls).toBe(1);
});
test('separate captures toggle multiple selections and Other focuses its textarea', async () => {
  const { group, buttons } = question(true);
  await apply(capture(), 1);
  await apply(capture(), 2);
  expect(buttons.slice(0, 2).map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
  expect(await apply(capture(), 1)).toMatchObject({ ok: true, message: 'Cleared Small patch.' });
  await apply(capture(), 3);
  expect(document.activeElement).toBe(group.querySelector('textarea'));
});
test.each(['thread', 'prompt', 'label', 'order', 'remount', 'hidden', 'disabled', 'popup', 'focus'])(
  'refuses %s changes after capture',
  async (change) => {
    const { pane, group, buttons } = question();
    const target = capture();
    switch (change) {
      case 'thread':
        context = 'thread:two';
        break;
      case 'prompt':
        group.querySelector('legend')!.textContent = 'Another question';
        break;
      case 'label':
        buttons[0].textContent = 'Another answer';
        break;
      case 'order':
        group.append(buttons[0]);
        break;
      case 'remount':
        group.replaceWith(group.cloneNode(true));
        break;
      case 'hidden':
        pane.hidden = true;
        break;
      case 'disabled':
        group.disabled = true;
        break;
      case 'popup':
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Settings</div>');
        break;
      case 'focus':
        pane.dataset.focused = 'false';
        break;
    }
    expect(await apply(target, 1)).toMatchObject({ ok: false });
    expect(calls).toBe(0);
  },
);
test('ignores shortcut labels and declines absent or disabled answers', async () => {
  const { buttons } = question();
  const target = capture();
  buttons[0].querySelector('kbd')!.textContent = 'Alt+7';
  expect(await apply(target, 1)).toMatchObject({ ok: true });
  expect(await apply(capture(), 8)).toMatchObject({ ok: false });
  buttons[1].disabled = true;
  expect(await apply(capture(), 2)).toMatchObject({ ok: false });
  expect(calls).toBe(1);
});
test('rejects ambiguous questions and ignores unfocused or hidden panes', () => {
  const first = question();
  const second = question();
  first.pane.append(second.pane);
  second.pane.dataset.splitPaneId = 'nested';
  second.pane.querySelector('textarea')!.focus();
  expect(capture()).toMatchObject({ ok: true });
  first.pane.querySelector('textarea')!.focus();
  expect(capture()).toMatchObject({ ok: true });
  second.pane.dataset.focused = 'false';
  second.pane.querySelector('textarea')!.focus();
  expect(capture()).toMatchObject({ ok: false });
  first.pane.querySelector('textarea')!.focus();
  first.group.parentElement!.append(first.group.cloneNode(true));
  expect(capture()).toMatchObject({ ok: false });
});
test('owns the voice picker and refuses stale picker without falling through to a question', async () => {
  question();
  const root = document.createElement('div');
  root.role = 'dialog';
  document.body.append(root);
  let key: string | null = 'one';
  const choose = vi.fn(async () => ({ ok: true, outcome: 'completed' as const, message: 'Opened thread.' }));
  const picker: ChoicePicker = { root, key: 'one', currentKey: () => key, choose };
  const target = capture(picker);
  expect(target).toMatchObject({ ok: true, kind: 'picker' });
  key = 'two';
  expect(await apply(target, 1)).toMatchObject({ ok: false });
  expect(choose).not.toHaveBeenCalled();
  expect(calls).toBe(0);
  key = 'one';
  expect(await apply(capture(picker), 2)).toMatchObject({ ok: true });
  expect(choose).toHaveBeenCalledWith(2);
});
test('allows its own monitor but refuses another modal', () => {
  question();
  const monitor = document.createElement('div');
  monitor.role = 'dialog';
  document.body.append(monitor);
  expect(capture(undefined, monitor)).toMatchObject({ ok: true });
  document.body.insertAdjacentHTML('beforeend', '<div role="listbox">Suggestions</div>');
  expect(capture(undefined, monitor)).toMatchObject({ ok: false });
});
test('choice activation does not advance or submit the question', async () => {
  const { pane, group, buttons } = question();
  const form = document.createElement('form');
  pane.replaceWith(form);
  form.append(pane);
  const submitted = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submitted);
  buttons.forEach((button) => {
    button.type = 'button';
  });
  const advance = document.createElement('button');
  advance.type = 'button';
  advance.textContent = 'Next';
  const advanced = vi.fn();
  advance.addEventListener('click', advanced);
  group.parentElement!.append(advance);
  await apply(capture(), 1);
  expect(submitted).not.toHaveBeenCalled();
  expect(advanced).not.toHaveBeenCalled();
  expect(calls).toBe(1);
});
test('closed picker and lost window focus reject the captured target', async () => {
  question();
  const root = document.createElement('div');
  document.body.append(root);
  const choose = vi.fn(async () => ({ ok: true, message: 'Opened thread.' }));
  const picker: ChoicePicker = { root, key: 'one', currentKey: () => 'one', choose };
  const target = capture(picker);
  root.remove();
  expect(await apply(target, 1)).toMatchObject({ ok: false });
  expect(choose).not.toHaveBeenCalled();
  expect(calls).toBe(0);
  const native = capture();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  expect(await apply(native, 1)).toMatchObject({ ok: false });
  expect(calls).toBe(0);
});
