// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChipPopover } from './chip.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

function popover(props: Partial<Parameters<typeof ChipPopover>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(<ChipPopover aria-label="Git status" trigger={() => null} anchor={{ right: 500, bottom: 40 }} width={320}
    onClose={onClose} {...props}><button type="button">Row</button></ChipPopover>);
  return { ...view, onClose, dialog: view.getByRole('dialog', { name: 'Git status' }) as HTMLDialogElement };
}

test('opens as a modal dialog that BB counts as modal', () => {
  const { dialog } = popover({ className: 'gg-dialog', panelClassName: 'gg-panel' });
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.className).toBe('bbp-popover gg-dialog');
  expect(dialog.firstElementChild?.className).toBe('bbp-popover-panel gg-panel');
});

test('sits 8 px under the chip with its right edge on the chip', () => {
  const { dialog } = popover();
  expect(dialog.style.top).toBe('48px');
  expect(dialog.style.left).toBe('180px');
  expect(dialog.style.width).toBe('320px');
});

test('without a chip it centres near the top', () => {
  const { dialog } = popover({ anchor: null });
  expect(dialog.style.left).toBe(`${(window.innerWidth - 320) / 2}px`);
  expect(dialog.style.top).toBe(`${Math.round(window.innerHeight * 0.1)}px`);
});

test('Escape closes, unless the plugin gives it another action', () => {
  const first = popover();
  fireEvent(first.dialog, new Event('cancel', { cancelable: true }));
  expect(first.onClose).toHaveBeenCalledOnce();
  cleanup();
  const onEscape = vi.fn();
  const second = popover({ onEscape });
  fireEvent(second.dialog, new Event('cancel', { cancelable: true }));
  expect(onEscape).toHaveBeenCalledOnce();
  expect(second.onClose).not.toHaveBeenCalled();
});

test('keys stop at the popover except Escape, and still reach the plugin', () => {
  const seen: string[] = [];
  const outside = (event: KeyboardEvent) => seen.push(event.key);
  document.addEventListener('keydown', outside);
  const onKeyDown = vi.fn();
  const { getByRole } = popover({ onKeyDown });
  fireEvent.keyDown(getByRole('button', { name: 'Row' }), { key: 'j' });
  fireEvent.keyDown(getByRole('button', { name: 'Row' }), { key: 'Escape' });
  document.removeEventListener('keydown', outside);
  expect(seen).toEqual(['Escape']);
  expect(onKeyDown).toHaveBeenCalledTimes(2);
});

test('a press on the backdrop closes; a press on the popover does not', () => {
  const { dialog, onClose } = popover();
  dialog.getBoundingClientRect = () => DOMRect.fromRect({ x: 180, y: 48, width: 320, height: 200 });
  // jsdom has no PointerEvent; a MouseEvent of the same type carries the coordinates.
  const press = (x: number, y: number) => fireEvent(dialog, new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  press(300, 100);
  expect(onClose).not.toHaveBeenCalled();
  press(10, 10);
  expect(onClose).toHaveBeenCalledOnce();
});

test('closing returns focus to the chip, unless an action moved it elsewhere', () => {
  document.body.insertAdjacentHTML('beforeend', '<button id="chip">chip</button><input id="elsewhere">');
  const chip = document.getElementById('chip')!;
  const first = popover({ trigger: () => chip });
  first.getByRole('button', { name: 'Row' }).focus();
  first.unmount();
  expect(document.activeElement).toBe(chip);

  const second = popover({ trigger: () => chip });
  second.getByRole('button', { name: 'Row' }).focus();
  document.getElementById('elsewhere')!.focus();
  second.unmount();
  expect(document.activeElement?.id).toBe('elsewhere');
  document.body.replaceChildren();
});
