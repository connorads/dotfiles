import { useRef, useState } from 'react';
import type { Effort } from '../../src/models/contract.ts';
import { ListPopover } from './popover.tsx';

const EFFORT_LABEL: Readonly<Record<string, string>> = {
  default: 'Provider default', none: 'None', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra', ultracode: 'Ultracode',
};
const LEVEL: Readonly<Record<string, number>> = { default: 0, none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 4, ultra: 4, ultracode: 4 };

export function effortLabel(effort: Effort): string {
  return EFFORT_LABEL[effort] ?? effort;
}

/** Four bars, filled to the effort's level and tinted beyond xhigh; none for Default. */
export function EffortGlyph({ effort }: { effort: Effort | undefined }) {
  const level = effort ? LEVEL[effort] ?? 0 : 0;
  return <svg className="mf-glyph" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
    data-peak={(level === 4 && effort !== 'xhigh') || undefined}>
    {[0, 1, 2, 3].map(bar => <rect key={bar} x={0.5 + bar * 3} y={9 - bar * 2.5} width="2" height={2.5 + bar * 2.5} rx="0.75"
      data-on={bar < level || undefined} />)}
  </svg>;
}

/** A favourite's saved effort as a pill that opens a listbox of the model's efforts plus Default. */
export function EffortPill({ name, saved, fallback, levels, disabled, onChange }: {
  name: string; saved: Effort | undefined; fallback: Effort; levels: readonly Effort[]; disabled: boolean; onChange: (effort: Effort | null) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const unavailable = saved !== undefined && !levels.includes(saved);
  const label = saved === undefined ? 'Default' : unavailable ? `${effortLabel(saved)} (unavailable)` : effortLabel(saved);
  return <>
    <button ref={button} type="button" className="mf-pill" data-tone={unavailable ? 'warning' : undefined} disabled={disabled}
      aria-label={`Saved effort for ${name}: ${label}`} aria-haspopup="listbox" aria-expanded={open}
      title="Effort this favourite selects" onClick={() => setOpen(value => !value)}>
      <EffortGlyph effort={saved} />{label}
    </button>
    {open && <ListPopover anchor={button} label={`Saved effort for ${name}`} align="end" value={saved ?? ''}
      choices={[{ value: '', label: <><EffortGlyph effort={undefined} />Default</>, detail: effortLabel(fallback) },
        ...levels.map(level => ({ value: level, label: <><EffortGlyph effort={level} />{effortLabel(level)}</> })),
        ...(unavailable ? [{ value: saved, label: <><EffortGlyph effort={saved} />{effortLabel(saved)} (unavailable)</>, tone: 'warning' as const }] : [])]}
      onSelect={value => { if (value !== (saved ?? '')) onChange(value === '' ? null : value as Effort); }}
      onClose={() => setOpen(false)} />}
  </>;
}

/** A radiogroup of mutually exclusive options; arrow keys move and select, as native radios do. */
export function Segmented({ label, options, value, disabled, onChange }: {
  label: string; options: readonly { value: string; label: string }[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const current = Math.max(0, options.findIndex(option => option.value === value));
  function keyboard(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault(); event.stopPropagation();
    if (disabled) return;
    const next = (current + step + options.length) % options.length;
    group.current?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
    const option = options[next];
    if (option) onChange(option.value);
  }
  return <div ref={group} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="mf-segmented" onKeyDown={keyboard}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={index === current}
      tabIndex={index === current ? 0 : -1} disabled={disabled} onClick={() => { if (option.value !== value) onChange(option.value); }}>
      {option.label}
    </button>)}
  </div>;
}
