import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type DialogHTMLAttributes, type ReactNode, type Ref } from 'react';
import './popover.css';

/**
 * Where the chip sat when the popover opened. Null centres the popover near the top.
 * With `top`, the popover can open above a chip that sits low on screen.
 */
type ChipAnchor = { right: number; bottom: number; top?: number } | null;
/** `bottom`, when set, pins the panel's bottom edge that far above the window's bottom, and `top` is ignored. */
type PopoverPlacement = { top: number; left: number; width: number; origin: string; bottom?: number };

const margin = 12;
const gap = 8;

/** Right edge on the chip's right edge, 8 px below it, or above it when there is more room above. Kept on screen. */
function placeUnder(anchor: ChipAnchor, width: number): PopoverPlacement {
  const w = Math.min(width, window.innerWidth - margin * 2);
  if (!anchor) return { width: w, top: Math.round(window.innerHeight * 0.1), left: (window.innerWidth - w) / 2, origin: 'top center' };
  const left = Math.min(Math.max(margin, anchor.right - w), window.innerWidth - w - margin);
  const top = anchor.bottom + gap;
  if (anchor.top !== undefined && anchor.top - gap > window.innerHeight - top) {
    return { width: w, top, bottom: window.innerHeight - anchor.top + gap, left, origin: `${anchor.right - left}px 100%` };
  }
  return { width: w, top, left, origin: `${anchor.right - left}px 0` };
}

/** A pointer event on the dialog itself, outside its box: the ::backdrop. */
function onBackdrop(event: { target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number }) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

type ChipPopoverProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'style' | 'onCancel' | 'onPointerDown'> & {
  ref?: Ref<HTMLDialogElement>;
  'aria-label': string;
  /** The chip that opens the popover. Placement follows it, and focus returns to it on close. */
  trigger: () => HTMLElement | null;
  /** Where the chip was at open time, for when `trigger` finds no chip. */
  anchor: ChipAnchor;
  width: number;
  /** Opened by keyboard: no entrance, so a shortcut used all day feels instant. */
  instant?: boolean;
  /** Replaces the placement under the chip, for a popover with a second layout. */
  place?: () => PopoverPlacement;
  panelClassName?: string;
  onClose: () => void;
  /** Escape's action when it does more than close, such as leaving a sub-screen. Defaults to `onClose`. */
  onEscape?: () => void;
  children: ReactNode;
};

/**
 * A chip's pop-up: a modal <dialog> under the chip. aria-modal sets BB's `modalOpen`,
 * which BB does not derive from showModal(). Other keys stop here so BB's global shortcuts
 * ignore them; Escape goes on to the dialog's cancel.
 */
export function ChipPopover({ ref, trigger, anchor, width, instant, place, panelClassName, onClose, onEscape, onKeyDown, onClick, className, children, ...dialog }: ChipPopoverProps) {
  const element = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useImperativeHandle(ref, () => element.current!, []);
  useLayoutEffect(() => {
    const node = element.current;
    node?.showModal();
    // A focused control that unmounts, turns disabled or hides, such as a sub-screen's input or a Save button
    // during a save, drops focus to <body>, where keys miss the key guard and the plugin's shortcuts. Keep focus on
    // the dialog instead. Not when focus leaves a control that is still usable, such as Tab out of the page.
    const keepFocus = () => {
      if (node?.open && (!document.activeElement || document.activeElement === document.body)) node.focus({ preventScroll: true });
    };
    const lostControl = (event: FocusEvent) => {
      const lost = event.target as HTMLElement;
      if (event.relatedTarget === null && (lost.matches(':disabled') || lost.closest('[inert]') || lost.checkVisibility?.() === false)) keepFocus();
    };
    // Removal fires no focusout in some engines, hence the observer as well.
    const removals = new MutationObserver(keepFocus);
    if (node) removals.observe(node, { childList: true, subtree: true });
    node?.addEventListener('focusout', lostControl);
    return () => {
      removals.disconnect();
      node?.removeEventListener('focusout', lostControl);
      // Return focus only from the popover: an action that moved it elsewhere keeps it there.
      const active = document.activeElement;
      const restore = !active || active === document.body || (node?.contains(active) ?? false);
      node?.close();
      if (restore) trigger()?.focus({ preventScroll: true });
    };
  }, []);
  const [, relayout] = useState(0);
  useEffect(() => {
    const resize = () => relayout(count => count + 1);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const position = place?.() ?? placeUnder(trigger()?.getBoundingClientRect() ?? anchor, width);

  return <dialog tabIndex={-1} {...dialog} ref={element} className={className ? `bbp-popover ${className}` : 'bbp-popover'} aria-modal="true"
    data-instant={instant || undefined}
    style={{ left: position.left, width: position.width, transformOrigin: position.origin,
      ...position.bottom === undefined
        ? { top: position.top, '--bbp-popover-top': `${position.top}px` }
        : { bottom: position.bottom, '--bbp-popover-bottom': `${position.bottom}px` } } as CSSProperties}
    onKeyDown={event => {
      if (event.key !== 'Escape') event.stopPropagation();
      onKeyDown?.(event);
    }}
    onCancel={event => { event.preventDefault(); (onEscape ?? onClose)(); }}
    // Close on the backdrop click, not the press: closing on press lets the rest of a tap land on whatever lies
    // under the backdrop, such as the chip, which then reopens the popover.
    onPointerDown={event => { pressedBackdrop.current = onBackdrop(event); }}
    onClick={event => {
      onClick?.(event);
      if (pressedBackdrop.current && onBackdrop(event)) onClose();
      pressedBackdrop.current = false;
    }}>
    <div className={panelClassName ? `bbp-popover-panel ${panelClassName}` : 'bbp-popover-panel'}>{children}</div>
  </dialog>;
}
