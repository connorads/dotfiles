import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import './chip.css';

/** Status hue for a chip's border and text. Healthy chips pass none. */
export type ChipTone = 'warn' | 'danger';
/** Status hue for a dot; the dot carries state, the chip stays muted. */
export type DotTone = 'ok' | 'warn' | 'danger';

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  icon: ReactNode;
  tone?: ChipTone;
  /** Set when the chip opens a dialog; leave undefined for a chip without one. */
  expanded?: boolean;
};

/** A thread-header chip: one icon, then at most one value and a status mark. */
export function Chip({ icon, tone, expanded, className, children, ...button }: ChipProps) {
  return <button type="button" {...button} className={className ? `bbp-chip ${className}` : 'bbp-chip'} data-tone={tone}
    aria-haspopup={expanded === undefined ? undefined : 'dialog'} aria-expanded={expanded}>
    <span className="bbp-chip-icon" aria-hidden="true">{icon}</span>
    {children}
  </button>;
}

/** The chip's primary value, in foreground colour. */
export function ChipValue({ className, ...span }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...span} className={className ? `bbp-chip-value ${className}` : 'bbp-chip-value'} />;
}

/** A 6px status dot with an optional count beside it. */
export function ChipDot({ tone, className, children, ...span }: HTMLAttributes<HTMLSpanElement> & { tone: DotTone }) {
  return <span {...span} className={className ? `bbp-chip-dot ${className}` : 'bbp-chip-dot'} data-tone={tone}>
    <i aria-hidden="true" />{children}
  </span>;
}

export { ChipPopover } from './popover.tsx';
