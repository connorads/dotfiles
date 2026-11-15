import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type DialogHTMLAttributes, type ReactNode, type Ref } from 'react';
import './popover.css';

/** Where the chip sat when the popover opened. Null centres the popover near the top. */
type ChipAnchor = { right: number; bottom: number } | null;
type PopoverPlacement = { top: number; left: number; width: number; origin: string };

const margin = 12;

/** Right edge on the chip's right edge, 8 px below it, kept on screen. */
function placeUnder(anchor: ChipAnchor, width: number): PopoverPlacement {
  const w = Math.min(width, window.innerWidth - margin * 2);
  if (!anchor) return { width: w, top: Math.round(window.innerHeight * 0.1), left: (window.innerWidth - w) / 2, origin: 'top center' };
  const left = Math.min(Math.max(margin, anchor.right - w), window.innerWidth - w - margin);
  return { width: w, top: anchor.bottom + 8, left, origin: `${anchor.right - left}px 0` };
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
    // A focused control that unmounts, such as a sub-screen's input, drops focus to <body>, where keys miss the
    // key guard and the plugin's shortcuts. Keep focus on the dialog instead.
    const keepFocus = new MutationObserver(() => {
      if (node?.open && (!document.activeElement || document.activeElement === document.body)) node.focus({ preventScroll: true });
    });
    if (node) keepFocus.observe(node, { childList: true, subtree: true });
    return () => {
      keepFocus.disconnect();
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
    style={{ top: position.top, left: position.left, width: position.width, transformOrigin: position.origin,
      '--bbp-popover-top': `${position.top}px` } as CSSProperties}
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
