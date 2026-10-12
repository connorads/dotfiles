import { createContext, useEffect, useState } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { Change } from './contracts.ts';
import { diffBlocks } from './src/format.ts';

export const codeNames: Record<Change['code'], string> = {
  A: 'Added', C: 'Copied', D: 'Deleted', M: 'Modified', R: 'Renamed', T: 'Type changed', U: 'Conflicted', '?': 'Untracked',
};
export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export const changeKey = (change: Change) => `${change.area}:${change.path}`;
/** Zoomed views have room for side-by-side diffs. */
export const Zoomed = createContext(false);

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(id); }, [intervalMs]);
  return now;
}
export function Fact({ tone, icon, title, children }: { tone: string; icon: string; title: string; children: React.ReactNode }) {
  return <span className="gg-fact" data-tone={tone} title={title}><Icon name={icon} className="size-3" />{children}</span>;
}

export function DiffBar({ added, removed }: { added: number | null; removed: number | null }) {
  return <span className="gg-blocks" aria-hidden>
    {diffBlocks(added ?? 0, removed ?? 0).map((block, index) => <i key={index} data-block={block} />)}
  </span>;
}
/** Copy and Check stacked, cross-faded, so the swap has both an exit and an entry. */
export function CopyIcon({ done }: { done: boolean }) {
  return <span className="gg-swap" data-done={done || undefined} aria-hidden>
    <Icon name="Copy" className="size-3" /><Icon name="Check" className="size-3" />
  </span>;
}

/**
 * A destructive action that needs intent: hold the pointer for the fill to
 * complete, or press twice from the keyboard. Releasing early cancels.
 */
export function HoldButton({ icon, label, confirmLabel, onConfirm, disabled = false }: {
  icon: string; label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  const release = () => setHolding(false);
  return <button type="button" className="gg-hold" data-holding={holding || undefined} data-armed={armed || undefined}
    disabled={disabled} aria-label={armed ? confirmLabel : label} title={armed ? confirmLabel : `Hold to ${label.toLowerCase()}`}
    onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); } }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onClick={event => {
      // Pointer clicks act only through the hold; detail 0 is a keyboard click.
      if (event.detail !== 0) return;
      if (armed) { setArmed(false); onConfirm(); } else setArmed(true);
    }}>
    <span className="gg-hold-fill" aria-hidden
      onTransitionEnd={event => { if (event.propertyName === 'clip-path' && holding) { setHolding(false); onConfirm(); } }} />
    <Icon name={icon} className="size-3.5" />
    <span>{armed ? confirmLabel : label}</span>
  </button>;
}
