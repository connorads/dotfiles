/**
 * Closed-form SwiftUI spring, shared rAF read-before-write frame loop,
 * pure transition state machines, and phase-locked offscreen animation sync.
 */

const coeffCache = new Float64Array(7);

function computeCoeffs(omega: number, zeta: number, t: number) {
  coeffCache[0] = omega;
  coeffCache[1] = zeta;
  coeffCache[2] = t;
  const zw = zeta * omega;
  const e = Math.exp(-zw * t);
  const nearCritical = Math.abs(zeta - 1) < 1e-7;
  const wd = nearCritical ? 0 : omega * Math.sqrt(Math.abs(1 - zeta * zeta));
  const wdt = wd * t;
  const c = nearCritical ? 1 : zeta < 1 ? Math.cos(wdt) : Math.cosh(wdt);
  const s = nearCritical ? t : (zeta < 1 ? Math.sin(wdt) : Math.sinh(wdt)) / wd;
  coeffCache[3] = e * (c + zw * s);
  coeffCache[4] = e * s;
  coeffCache[5] = -e * omega * omega * s;
  coeffCache[6] = e * (c - zw * s);
}

/** Optional global slow-motion multiplier (set window.__agysMotionScale = 4 for 0.25x inspection). */
export function motionTimeScale(): number {
  if (typeof globalThis === 'undefined') return 1;
  const raw = (globalThis as { __agysMotionScale?: unknown }).__agysMotionScale;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  omega: number;
  zeta: number;

  constructor(value: number, { omega = 26, zeta = 1 } = {}) {
    this.value = value;
    this.target = value;
    this.omega = omega;
    this.zeta = zeta;
  }

  static fromDuration(value: number, { duration, bounce = 0 }: { duration: number; bounce?: number }) {
    const scaled = Math.max(0.01, duration * motionTimeScale());
    return new Spring(value, { omega: (2 * Math.PI) / scaled, zeta: Math.max(0.05, 1 - bounce) });
  }

  reconfigure({ duration, bounce = 0 }: { duration: number; bounce?: number }) {
    const scaled = Math.max(0.01, duration * motionTimeScale());
    this.omega = (2 * Math.PI) / scaled;
    this.zeta = Math.max(0.05, 1 - bounce);
    return this;
  }

  set(target: number, opts?: { velocity?: number }) {
    this.target = target;
    if (opts?.velocity !== undefined) this.velocity = opts.velocity;
    return this;
  }

  snap(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    return this;
  }

  step(dt: number): number {
    const x0 = this.value - this.target;
    const v0 = this.velocity;
    if (x0 === 0 && v0 === 0) return this.target;
    const t = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    if (t === 0) return this.value;
    if (this.omega !== coeffCache[0] || this.zeta !== coeffCache[1] || t !== coeffCache[2]) {
      computeCoeffs(this.omega, this.zeta, t);
    }
    const d = coeffCache[3]! * x0 + coeffCache[4]! * v0;
    const v = coeffCache[5]! * x0 + coeffCache[6]! * v0;
    if (Math.abs(d) < 0.005 && Math.abs(v) < 0.02) return this.snap(this.target).value;
    this.value = this.target + d;
    this.velocity = v;
    return this.value;
  }

  get resting(): boolean {
    return Math.abs(this.value - this.target) < 0.005 && Math.abs(this.velocity) < 0.02;
  }
}

interface FrameJob {
  read?: () => void;
  write: (dt: number) => boolean;
}

class SharedFrameLoop {
  private jobs = new Set<FrameJob>();
  private rafId: number | null = null;
  private lastTs: number | null = null;

  add(write: (dt: number) => boolean): () => void {
    return this.addMeasured(undefined, write);
  }

  addMeasured(read: (() => void) | undefined, write: (dt: number) => boolean): () => void {
    const job: FrameJob = { read, write };
    this.jobs.add(job);
    this.ensureRunning();
    return () => {
      this.jobs.delete(job);
      if (this.jobs.size === 0 && this.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.lastTs = null;
      }
    };
  }

  private ensureRunning() {
    if (this.rafId !== null || typeof requestAnimationFrame !== 'function') return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (ts: number) => {
    this.rafId = null;
    const dt = this.lastTs === null ? 1 / 60 : Math.min(0.1, Math.max(0, (ts - this.lastTs) / 1000));
    this.lastTs = ts;

    const snapshot = [...this.jobs];
    for (const job of snapshot) job.read?.();
    for (const job of snapshot) {
      if (!this.jobs.has(job)) continue;
      if (!job.write(dt)) this.jobs.delete(job);
    }

    if (this.jobs.size > 0) {
      this.ensureRunning();
    } else {
      this.lastTs = null;
    }
  };
}

export const frameLoop = new SharedFrameLoop();

/* -------------------------------------------------------------------------- */
/* Pure Shimmer State Machine (inactive | active | fading)                    */
/* -------------------------------------------------------------------------- */

export type ShimmerPhase = 'inactive' | 'active' | 'fading';

export interface ShimmerState {
  readonly phase: ShimmerPhase;
  readonly attempt: number;
}

export type ShimmerEvent =
  | { type: 'activate' }
  | { type: 'deactivate' }
  | { type: 'fade-done'; attempt: number }
  | { type: 'reduced' }
  | { type: 'disposed' };

export type ShimmerEffect =
  | { type: 'schedule-fade-done'; attempt: number; delayMs: number }
  | { type: 'cancel-timer' };

export function initialShimmerState(active: boolean, reduced: boolean): ShimmerState {
  return { phase: active && !reduced ? 'active' : 'inactive', attempt: 0 };
}

export function reduceShimmer(
  state: ShimmerState,
  event: ShimmerEvent,
  fadeMs = 220,
): { readonly state: ShimmerState; readonly effects: readonly ShimmerEffect[] } {
  switch (event.type) {
    case 'reduced':
    case 'disposed':
      return { state: { phase: 'inactive', attempt: state.attempt + 1 }, effects: [{ type: 'cancel-timer' }] };
    case 'activate':
      if (state.phase === 'active') return { state, effects: [] };
      return {
        state: { phase: 'active', attempt: state.attempt + 1 },
        effects: [{ type: 'cancel-timer' }],
      };
    case 'deactivate': {
      if (state.phase !== 'active') return { state, effects: [] };
      const attempt = state.attempt + 1;
      return {
        state: { phase: 'fading', attempt },
        effects: [{ type: 'schedule-fade-done', attempt, delayMs: Math.round(fadeMs * motionTimeScale()) }],
      };
    }
    case 'fade-done':
      if (state.phase !== 'fading' || event.attempt !== state.attempt) return { state, effects: [] };
      return { state: { phase: 'inactive', attempt: state.attempt }, effects: [] };
  }
}

/* -------------------------------------------------------------------------- */
/* Pure Odometer Digit Helper (forward-only 3-decade roll, no 9->0 rewind)    */
/* -------------------------------------------------------------------------- */

export interface OdometerDigit {
  /** Place index (0 = ones, 1 = tens, ...). Stable across carries. */
  place: number;
  /** Visible digit 0..9. */
  digit: number;
  /** Offset into the 30-cell 0..9×3 strip (resting decade is 10..19). */
  offset: number;
  animating: boolean;
}

export function extractDigits(value: number): number[] {
  const safe = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return String(safe).split('').map(ch => Number(ch));
}

export function nextOdometerOffset(prevDigit: number, nextDigit: number, direction: 1 | -1): number {
  const base = 10 + prevDigit;
  if (prevDigit === nextDigit) return base;
  if (direction === 1) {
    const delta = (nextDigit - prevDigit + 10) % 10;
    return base + delta;
  }
  const delta = (prevDigit - nextDigit + 10) % 10;
  return base - delta;
}

/* -------------------------------------------------------------------------- */
/* Phase-Locked Spinners & Offscreen Pause                                    */
/* -------------------------------------------------------------------------- */

let pendingPhaseSync: Set<HTMLElement> | null = null;
let sharedObserver: IntersectionObserver | null = null;

function pinAnimationsToOrigin(el: HTMLElement) {
  if (typeof el.getAnimations !== 'function') return;
  for (const anim of el.getAnimations()) {
    try {
      anim.startTime = 0;
    } catch {
      // Ignore read-only timelines.
    }
  }
}

function schedulePhaseSync(el: HTMLElement) {
  if (!pendingPhaseSync) {
    pendingPhaseSync = new Set();
    frameLoop.add(() => {
      const batch = pendingPhaseSync;
      pendingPhaseSync = null;
      if (batch) {
        for (const node of batch) pinAnimationsToOrigin(node);
      }
      return false;
    });
  }
  pendingPhaseSync.add(el);
}

function getSharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          delete el.dataset.offscreen;
          schedulePhaseSync(el);
        } else {
          el.dataset.offscreen = 'true';
        }
      }
    });
  }
  return sharedObserver;
}

export function registerPhaseLocked(el: HTMLElement): () => void {
  schedulePhaseSync(el);
  const observer = getSharedObserver();
  observer?.observe(el);
  return () => {
    observer?.unobserve(el);
    pendingPhaseSync?.delete(el);
  };
}
