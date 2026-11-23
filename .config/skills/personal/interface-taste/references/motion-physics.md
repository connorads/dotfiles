# Motion Physics & Zero-Reflow Transitions

Implementation recipes for physics-driven springs, zero-reflow panels,
single-surface height morphing, and deterministic transition lifecycles.

## 1. Exact Closed-Form SwiftUI Spring

Avoid semi-implicit Euler loops and raw `stiffness`/`damping` guesses. Use an
exact analytic damped-harmonic step parameterized by Apple's nonnegative
`(duration, bounce)` mapping:

- `ω = 2π / duration` (rad/s)
- `ζ = 1 - bounce` (`bounce: 0` → critically damped `ζ = 1`)
- Clamp `dt` to `0.1` s so tab-switches never explode the step.
- Snap cleanly to rest when `|value - target| < 0.005` and `|velocity| < 0.02`.
- Cache the 2×2 state transition matrix in a `Float64Array(7)` keyed by
  `(ω, ζ, dt)` so `step()` allocates nothing per frame.

```ts
const m = new Float64Array(7)

function coeffs(w: number, z: number, t: number) {
  m[0] = w; m[1] = z; m[2] = t
  const zw = z * w
  const e = Math.exp(-zw * t)
  const near = Math.abs(z - 1) < 1e-7
  const wd = near ? 0 : w * Math.sqrt(Math.abs(1 - z * z))
  const wdt = wd * t
  const c = near ? 1 : z < 1 ? Math.cos(wdt) : Math.cosh(wdt)
  const s = near ? t : (z < 1 ? Math.sin(wdt) : Math.sinh(wdt)) / wd
  m[3] = e * (c + zw * s)
  m[4] = e * s
  m[5] = -e * w * w * s
  m[6] = e * (c - zw * s)
}

export class Spring {
  value = 0; target = 0; velocity = 0; omega = 26; zeta = 0.86

  constructor(value: number, { omega = 26, zeta = 0.86 } = {}) {
    this.value = this.target = value
    this.omega = omega
    this.zeta = zeta
  }

  static fromDuration(value: number, { duration, bounce }: { duration: number; bounce: number }) {
    return new Spring(value, { omega: (2 * Math.PI) / duration, zeta: 1 - bounce })
  }

  set(target: number, opts?: { velocity?: number }) {
    this.target = target
    if (opts?.velocity !== undefined) this.velocity = opts.velocity
    return this
  }

  snap(value: number) {
    this.value = this.target = value
    this.velocity = 0
    return this
  }

  step(dt: number) {
    const x0 = this.value - this.target
    const v0 = this.velocity
    if (x0 === 0 && v0 === 0) return this.target
    const t = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0
    if (t === 0) return this.value
    if (this.omega !== m[0] || this.zeta !== m[1] || t !== m[2]) coeffs(this.omega, this.zeta, t)
    const d = m[3] * x0 + m[4] * v0
    const v = m[5] * x0 + m[6] * v0
    if (Math.abs(d) < 0.005 && Math.abs(v) < 0.02) return this.snap(this.target).value
    this.value = this.target + d
    this.velocity = v
    return this.value
  }

  get resting() {
    return Math.abs(this.value - this.target) < 0.005 && Math.abs(this.velocity) < 0.02
  }
}
```

### Default Presets (All Bounce-Free)

| Role | Duration | Bounce | Notes |
|---|---|---|---|
| Segmented pill / crisp toggle | `0.15s` | `0` | Immediate response |
| Sidebar peek (hover overlay) | `0.18s` | `0` | Quicker than docked panel |
| Docked sidebar / edge panel | `0.15s-0.30s` | `0` | Scale by `0.30 * √(width / 480)`, clamped `[0.15, 0.30]` |
| Dock height morph / card switch | `0.35s-0.45s` | `0` | Snappy `0.35`, Smooth `0.40-0.45`, Calm `0.55` |
| Rolling stepper digit | `0.375s` | `0` | Matches card switch |

Scale all durations by a single `motionTimeScale()` factor (`(slow ? 4 : 1) / speed`) so toggling slow motion lets you inspect every transition at `0.25×`.

## 2. Shared Frame Loop (`read` Before `write`)

Never let separate components call `requestAnimationFrame` independently - their
`getBoundingClientRect()` reads will interleave with other components' style
writes and force multiple layouts per frame.

- Maintain **one shared `frameLoop`** with `add(write)` and
  `addMeasured(read, write)`.
- Each frame runs **every registered `read` before any `write`**.
- Cancel `rAF` automatically when the last job returns `false` (resting).
- Use `1/60` s for the first frame after sleep; clamp subsequent `dt` to `0.1` s.
- **State owns targets; motion owns displayed values**: framework signals/state
  only call `spring.set(nextTarget)`. The `write` callback mutates
  `el.style.*` or `el.textContent` directly - zero React/Solid re-renders per
  frame.
- Always snap on first mount and under `prefersReducedMotion()`, and listen for
  live `prefers-reduced-motion` changes so in-flight springs settle cleanly.

## 3. Zero-Reflow Edge Panels (`holdLandingWidth`)

Animating a panel's real layout width keeps the neighbour's edge locked to the
panel on every frame, **provided** the neighbour doesn't re-wrap text on every
frame. Do not fake this with a hardcoded `sidebarWidth / 2` transform (which
breaks with resizable panels, right drawers, or start-aligned layouts).

Pattern:

1. Run the panel spring in **percent closed (`0` open → `100` closed)** so the
   `0.005` rest threshold stays well under a pixel.
2. When a flight starts (or reverses):
   - Measure in-view block positions inside the neighbouring content box
     (breadth-first, capped around 400 elements, skipping offscreen subtrees and
     inline boxes).
   - Temporarily paint moving panels at their **landing** state, read the
     neighbour's landing width, then restore current paint - all inside one
     start-of-flight measurement pass. Zero layout reads occur during the flight
     frames themselves.
   - Set a **non-inheriting** CSS custom property `--panel-hold-width: <landingPx>`
     on the content box (register via `@property` with `inherits: false`, or
     consume only on the direct box so clearing it doesn't restyle a long
     transcript).
   - For blocks whose width stays constant while their horizontal position
     changes (centered columns, right-aligned labels), record their delta and
     drive `el.style.translate = "${shift * remaining}px"` each frame alongside
     the panel spring.
   - When the flight lands, clear `--panel-hold-width` and `translate`.
3. **Tail-only panel opacity**: fade panel contents only across the final 15% of
   travel before closed (`opacity = min(1, (1 - closed) / 0.15)`). Contents stay
   solid while closing and arrive immediately when opening.
4. **Evict focus without `inert` restyling**: setting `inert` on a huge closing
   subtree can force a full-subtree style recalc. Instead, move focus out on
   close start and intercept `focusin` during closing flight.
5. **Defer layout-forcing work (`whenSettled`)**: queue post-flight focus moves
   or scroll adjustments until the spring lands.

## 4. Single-Surface Height Morphing (`clip-path`)

When one container swaps between faces of different heights (composer input ↔
queued tray ↔ question prompt):

- Animate `root.style.height` on one bounce-free spring (`duration: 0.40s`).
- During flight, stack entering and leaving faces `position: absolute; inset-inline: 0; top: 0`.
- Position each face with `translateY(offset)` and **clip it to its own animated
  box**: `clip-path: inset(0 0 calc(100% - <boxHeight>px) 0)`. Outgoing and
  incoming faces never draw over each other.
- Hold a closing face opaque until the last ~40% of its box height remains
  (`fadeTail = 0.4`), then fade cleanly before its box hits zero.
- Measure face heights via `ResizeObserver` at rest and once on flight start;
  never read `getBoundingClientRect()` inside the per-frame paint tick.
- Respect a short mount grace period so initial page render snaps at rest
  instead of animating in on load.

### In-Place Content Switch (Multi-Step Cards & Button Labels)

When switching between steps inside a card (`1 / 4 → 2 / 4`) or morphing a
button (`Next → Submit`):

- Keep `travel` tiny or `0px` (don't fling content 24px sideways).
- Resolve out of a subtle blur (`≤ 2px` - more costs paint and looks worse) and
  tiny scale (`0.97 → 1`).
- Give the switch spring an initial velocity kick (`launch: 0.3` of natural
  speed) so keyboard presses (`←`/`→`) register immediately without overshoot.
- Set `fadeOut` (~0.6) and `fadeIn` (~0.45) along the spring progress so old and
  new labels never read directly on top of each other while the container or
  button edge sweeps to its new size.

## 5. Pure State Machines for Transitions

Do not manage multi-phase animations with scattered booleans and `setTimeout`
chains. Colocate a small pure reducer (`*-machine.ts`) with unit tests:

```ts
export type Transition<S, E> = { readonly state: S; readonly effects: readonly E[] }
```

Include in every transition machine:

- An **attempt counter** (`attempt: number`) stamped onto timers and fallback
  timeouts so stale completions from an interrupted flight are ignored.
- Explicit **`reduced`** and **`disposed`** events so toggling reduced motion
  or unmounting mid-flight tears down cleanly.
- A **safety fallback timeout** (slightly longer than CSS transition duration or
  spring settle time) in case `transitionend` never fires (hidden tab, zero-size
  element).
