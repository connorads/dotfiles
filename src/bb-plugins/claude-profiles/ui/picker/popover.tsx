import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';

export type Choice = { value: string; label: ReactNode; detail?: ReactNode; tone?: 'warning' };

// Open popovers, innermost last, so the picker's Escape closes the innermost one before the dialog.
const stack: (() => void)[] = [];
export function closeInnermostPopover(): boolean {
  const close = stack.at(-1);
  close?.();
  return Boolean(close);
}

/** A small listbox anchored to its trigger, flipped above it when the viewport has no room below. */
export function ListPopover({ anchor, label, choices, value, align = 'start', onSelect, onClose }: {
  anchor: RefObject<HTMLElement | null>; label: string; choices: readonly Choice[]; value: string | null;
  align?: 'start' | 'end'; onSelect: (value: string) => void; onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex(choice => choice.value === value)));
  const dismiss = useRef(onClose);
  dismiss.current = onClose;
  useEffect(() => {
    const close = () => dismiss.current();
    stack.push(close);
    return () => { stack.splice(stack.indexOf(close), 1); };
  }, []);
  useLayoutEffect(() => {
    const trigger = anchor.current?.getBoundingClientRect();
    if (!trigger) return;
    const height = list.current?.offsetHeight ?? 0;
    const below = trigger.bottom + 4;
    const top = below + height > window.innerHeight - 8 && trigger.top - height - 4 > 8 ? trigger.top - height - 4 : below;
    setPosition(align === 'end' ? { top, right: window.innerWidth - trigger.right } : { top, left: trigger.left });
  }, [anchor, align]);
  useEffect(() => { list.current?.querySelectorAll<HTMLElement>('[role=option]')[active]?.focus(); }, [active, position]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !anchor.current?.contains(target)) dismiss.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [anchor]);
  function close() { onClose(); anchor.current?.focus(); }
  function keyboard(event: React.KeyboardEvent) {
    event.stopPropagation();
    const last = choices.length - 1;
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (event.key in moves) { event.preventDefault(); setActive(moves[event.key]!); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const choice = choices[active]; if (choice) { onSelect(choice.value); close(); } }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  }
  return <div ref={list} role="listbox" aria-label={label} className="mf-popover" onKeyDown={keyboard}
    style={position ? { top: position.top, left: position.left, right: position.right } : { visibility: 'hidden' }}>
    {choices.map((choice, index) => <div key={choice.value} role="option" aria-selected={choice.value === value}
      tabIndex={index === active ? 0 : -1} data-tone={choice.tone} className="mf-option"
      onClick={() => { onSelect(choice.value); close(); }} onPointerMove={() => setActive(index)}>
      <span className="mf-option-label">{choice.label}</span>
      {choice.detail !== undefined && <span className="mf-option-detail">{choice.detail}</span>}
      <Icon name="Check" className="mf-option-check" />
    </div>)}
  </div>;
}
