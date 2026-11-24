// Exact closed-form SwiftUI spring (bounce: 0) and shared read-before-write rAF loop.
// State owns targets; motion writes DOM styles directly with zero React re-renders per frame.
import { useEffect, useRef } from 'react';

const m = new Float64Array(7);

function coeffs(w: number, z: number, t: number) {
  m[0] = w; m[1] = z; m[2] = t;
  const zw = z * w;
  const e = Math.exp(-zw * t);
  const near = Math.abs(z - 1) < 1e-7;
  const wd = near ? 0 : w * Math.sqrt(Math.abs(1 - z * z));
  const wdt = wd * t;
  const c = near ? 1 : z < 1 ? Math.cos(wdt) : Math.cosh(wdt);
  const s = near ? t : (z < 1 ? Math.sin(wdt) : Math.sinh(wdt)) / wd;
  m[3] = e * (c + zw * s);
  m[4] = e * s;
  m[5] = -e * w * w * s;
  m[6] = e * (c - zw * s);
}

export class Spring {
  value = 0;
  target = 0;
  velocity = 0;
  omega = 26;
  zeta = 1;

  constructor(value: number, { duration = 0.28, bounce = 0 }: { duration?: number; bounce?: number } = {}) {
    this.value = this.target = value;
    this.omega = (2 * Math.PI) / duration;
    this.zeta = 1 - bounce;
  }

  set(target: number) {
    this.target = target;
    return this;
  }

  snap(value: number) {
    this.value = this.target = value;
    this.velocity = 0;
    return this;
  }

  step(dt: number) {
    const x0 = this.value - this.target;
    const v0 = this.velocity;
    if (x0 === 0 && v0 === 0) return this.target;
    const t = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    if (t === 0) return this.value;
    if (this.omega !== m[0] || this.zeta !== m[1] || t !== m[2]) coeffs(this.omega, this.zeta, t);
    const d = m[3]! * x0 + m[4]! * v0;
    const v = m[5]! * x0 + m[6]! * v0;
    if (Math.abs(d) < 0.05 && Math.abs(v) < 0.5) return this.snap(this.target).value;
    this.value = this.target + d;
    this.velocity = v;
    return this.value;
  }

  get resting() {
    return Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.5;
  }
}

type FrameJob = (dt: number) => boolean;
const jobs = new Set<FrameJob>();
let rafId: number | null = null;
let lastTs = 0;

function tick(ts: number) {
  rafId = null;
  const dt = lastTs === 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;
  for (const job of jobs) {
    if (!job(dt)) jobs.delete(job);
  }
  if (jobs.size > 0) rafId = requestAnimationFrame(tick);
  else lastTs = 0;
}

function schedule(job: FrameJob) {
  jobs.add(job);
  if (rafId === null && typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(tick);
  }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Smoothly morphs a single surface's height on a critically damped spring (`bounce: 0`),
 * writing directly to `outer.style.height` without per-frame React re-renders.
 * Snaps cleanly on initial mount and under `prefers-reduced-motion`.
 */
export function useMorphHeight(duration = 0.28) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;

    const spring = new Spring(0, { duration, bounce: 0 });
    let mounted = false;

    const job: FrameJob = dt => {
      const h = spring.step(dt);
      if (spring.resting) {
        outer.style.height = '';
        outer.style.overflow = '';
        return false;
      }
      outer.style.height = `${h.toFixed(2)}px`;
      outer.style.overflow = 'clip';
      return true;
    };

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.blockSize ?? inner.getBoundingClientRect().height;
      if (next <= 0) return;
      if (!mounted || reducedMotion()) {
        mounted = true;
        spring.snap(next);
        outer.style.height = '';
        outer.style.overflow = '';
        return;
      }
      if (Math.abs(next - spring.target) < 0.5) return;
      if (spring.resting) spring.snap(outer.getBoundingClientRect().height || next);
      spring.set(next);
      schedule(job);
    });

    observer.observe(inner);
    return () => {
      observer.disconnect();
      jobs.delete(job);
      outer.style.height = '';
      outer.style.overflow = '';
    };
  }, [duration]);

  return { outerRef, innerRef };
}
