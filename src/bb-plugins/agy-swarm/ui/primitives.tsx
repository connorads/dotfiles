import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Spring,
  extractDigits,
  frameLoop,
  initialShimmerState,
  nextOdometerOffset,
  prefersReducedMotion,
  reduceShimmer,
  registerPhaseLocked,
  type ShimmerState,
} from '../src/motion.ts';

const STRIP_CELLS = Array.from({ length: 30 }, (_, i) => i % 10);

/**
 * Odometer counter following interface-taste:
 * - Keyed by place value, spare leading zero for smooth width carry
 * - Animates `top` (never `transform`) to avoid 0.5px settle snap
 * - Fade mask strictly under `[data-animating="true"]`
 * - Visual digits via `::before { content: attr(data-digit) }` + single `.sr-only` node
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const safe = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const [prev, setPrev] = useState(safe);
  const [animating, setAnimating] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [offsets, setOffsets] = useState<Map<number, number>>(() => new Map());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (safe === prev) return;
    if (prefersReducedMotion()) {
      setPrev(safe);
      setAnimating(false);
      setResizing(false);
      return;
    }
    const direction: 1 | -1 = safe > prev ? 1 : -1;
    const prevDigits = extractDigits(prev);
    const nextDigits = extractDigits(safe);
    const maxPlaces = Math.max(prevDigits.length, nextDigits.length);

    // Seed starting offsets at the middle decade for prev digits, then advance next frame.
    const startMap = new Map<number, number>();
    const endMap = new Map<number, number>();
    for (let place = 0; place < maxPlaces; place++) {
      const pDigit = prevDigits[prevDigits.length - 1 - place] ?? 0;
      const nDigit = nextDigits[nextDigits.length - 1 - place] ?? 0;
      startMap.set(place, 10 + pDigit);
      endMap.set(place, nextOdometerOffset(pDigit, nDigit, direction));
    }

    setOffsets(startMap);
    setAnimating(true);
    setResizing(prevDigits.length !== nextDigits.length);

    const raf = requestAnimationFrame(() => {
      setOffsets(endMap);
    });

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPrev(safe);
      setAnimating(false);
      setResizing(false);
      setOffsets(new Map());
    }, 640);

    return () => cancelAnimationFrame(raf);
  }, [prev, safe]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const digits = extractDigits(safe);
  const prevDigits = extractDigits(prev);
  const displayPlaces = animating ? Math.max(digits.length, prevDigits.length) : digits.length;
  const places = Array.from({ length: displayPlaces }, (_, i) => displayPlaces - 1 - i);

  return (
    <span className={className} data-component="animated-number">
      <span className="agys-sr-only">{safe}</span>
      <span
        data-slot="animated-number-value"
        data-resizing={resizing ? 'true' : 'false'}
        style={{ '--animated-number-width': `${digits.length}ch` } as React.CSSProperties}
        aria-hidden="true"
      >
        {places.map(place => {
          const digit = digits[digits.length - 1 - place] ?? 0;
          const offset = offsets.get(place) ?? (10 + digit);
          const prevDigit = prevDigits[prevDigits.length - 1 - place] ?? 0;
          const digitRolling = animating && (prevDigit !== digit || place >= prevDigits.length);
          return (
            <span
              key={place}
              data-slot="animated-number-digit"
              data-animating={digitRolling ? 'true' : 'false'}
            >
              <span data-slot="animated-number-static" data-digit={digit} />
              <span
                data-slot="animated-number-strip"
                style={{ '--animated-number-offset': offset } as React.CSSProperties}
              >
                {STRIP_CELLS.map((cell, idx) => (
                  <span key={idx} data-slot="animated-number-cell" data-digit={cell} />
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Morphs plural suffix ("1 worker" <-> "2 workers") instead of snapping it. */
export function CountSuffix({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  if (plural.startsWith(singular)) {
    const suffix = plural.slice(singular.length);
    return (
      <span className="agys-count-label">
        {singular}
        <span data-slot="count-suffix" data-active={count !== 1 ? 'true' : 'false'} aria-hidden={count === 1 ? 'true' : undefined}>
          <span data-slot="count-suffix-inner">{suffix}</span>
        </span>
      </span>
    );
  }
  return <span className="agys-count-label">{count === 1 ? singular : plural}</span>;
}

/**
 * Counter-translating GPU compositor shimmer with 3-state fade-out machine.
 * Zero background-position repaints; fades smoothly on deactivation.
 */
export function TextShimmer({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const [machine, setMachine] = useState<ShimmerState>(() => initialShimmerState(active, prefersReducedMotion()));
  const timerRef = useRef<number | null>(null);

  const dispatch = (event: Parameters<typeof reduceShimmer>[1]) => {
    setMachine(current => {
      const { state, effects } = reduceShimmer(current, event);
      for (const eff of effects) {
        if (eff.type === 'cancel-timer' && timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (eff.type === 'schedule-fade-done') {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            dispatch({ type: 'fade-done', attempt: eff.attempt });
          }, eff.delayMs);
        }
      }
      return state;
    });
  };

  useEffect(() => {
    if (prefersReducedMotion()) {
      dispatch({ type: 'reduced' });
      return;
    }
    dispatch({ type: active ? 'activate' : 'deactivate' });
  }, [active]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const showSweep = machine.phase === 'active' || machine.phase === 'fading';
  const isActive = machine.phase === 'active';

  return (
    <span
      className={className}
      data-component="text-shimmer"
      data-active={isActive ? 'true' : 'false'}
      data-run={showSweep ? 'true' : 'false'}
    >
      <span data-slot="shimmer-base">{text}</span>
      {showSweep && (
        <span data-slot="shimmer-layer" aria-hidden="true">
          <span>{text}</span>
          <span data-slot="shimmer-sweep">
            <span data-slot="shimmer-sweep-text">{text}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Phase-locked status indicator (all working pulses locked to startTime = 0, paused offscreen). */
export function PhaseIndicator({ state }: { state: 'working' | 'waiting' | 'done' | 'killed' | 'error' }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || state !== 'working') return;
    return registerPhaseLocked(el);
  }, [state]);

  return (
    <span ref={ref} className="agys-status-mark" data-state={state} aria-hidden="true">
      {state === 'working' && <span className="agys-radar-ring" />}
      <span className="agys-status-core" />
    </span>
  );
}

export interface SegmentedItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/**
 * Segmented control with a bounce-free 0.15s SwiftUI spring thumb driven on
 * the shared read-before-write rAF loop (zero React re-renders per frame).
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const btnRefs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const xSpring = useRef(Spring.fromDuration(0, { duration: 0.15, bounce: 0 }));
  const wSpring = useRef(Spring.fromDuration(0, { duration: 0.15, bounce: 0 }));
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const activeBtn = btnRefs.current.get(value);
    if (!track || !thumb || !activeBtn) return;

    const targetX = activeBtn.offsetLeft;
    const targetW = activeBtn.offsetWidth;

    if (!mounted.current || prefersReducedMotion()) {
      mounted.current = true;
      xSpring.current.snap(targetX);
      wSpring.current.snap(targetW);
      thumb.style.transform = `translate3d(${targetX}px, 0, 0)`;
      thumb.style.width = `${targetW}px`;
      thumb.style.opacity = '1';
      return;
    }

    xSpring.current.reconfigure({ duration: 0.15, bounce: 0 }).set(targetX);
    wSpring.current.reconfigure({ duration: 0.15, bounce: 0 }).set(targetW);

    return frameLoop.add(dt => {
      const x = xSpring.current.step(dt);
      const w = wSpring.current.step(dt);
      thumb.style.transform = `translate3d(${x}px, 0, 0)`;
      thumb.style.width = `${w}px`;
      thumb.style.opacity = '1';
      return !xSpring.current.resting || !wSpring.current.resting;
    });
  }, [value, items.length]);

  return (
    <div ref={trackRef} className="agys-seg" role="tablist" aria-label={ariaLabel}>
      <span ref={thumbRef} className="agys-seg-thumb" aria-hidden="true" />
      {items.map(item => (
        <button
          key={item.id}
          ref={el => {
            if (el) btnRefs.current.set(item.id, el);
            else btnRefs.current.delete(item.id);
          }}
          type="button"
          role="tab"
          className="agys-seg-btn"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
          {item.count !== undefined && (
            <span className="agys-seg-count">
              <AnimatedNumber value={item.count} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
