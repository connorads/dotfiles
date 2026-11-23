---
name: interface-taste
description: >-
  Opinionated craft standards and implementation recipes for making web and
  desktop interfaces feel like flagship native software (inspired by OpenCode
  Desktop). Use when building or polishing UI motion, rolling or live-ticking
  numbers, shimmering status text, parallel spinners, collapsible sidebars,
  morphing composer or card surfaces, flyout menus, dark/light chrome,
  typography wrapping, or custom scrollbars - or when the user asks to give an
  interface great taste, native feel, or smooth micro-interactions. Not for
  screen architecture or task flows (ui-design), broad layout/colour scales
  (ui-design-playbook), or unsupervised multi-round polish loops
  (ui-hill-climb).
---

# Interface Taste

> **What subtle glitch, reflow, or cheap shortcut separates this from a native
> flagship app - and how do we fix it in physics, geometry, or paint rather than
> hiding it?**

Most web and Electron UIs look "almost right" at rest and fall apart in motion
or detail: text re-wraps 60 times a second when a sidebar opens, shimmers
repaint on the CPU every frame, rolling counters duplicate digits on copy or
snap by half a pixel on settle, and `scrollbar-width` silently disables custom
WebKit scrollbars in Chromium. This skill encodes a concrete stance for
eliminating those telltale web artifacts in both web and desktop apps.

Fit every technique into the project's existing styling and framework stack
(plain CSS, Tailwind, React, Solid, etc.) - never bolt on a second styling
system or heavy runtime just to apply polish.

## Boundaries

- **Screen structure, navigation, and task flows** → `ui-design`.
- **Foundational spacing/type/colour systems** → `ui-design-playbook`.
- **Unsupervised multi-round visual iteration** → `ui-hill-climb`.
- **This skill** owns the *craft layer* on top: motion physics, zero-reflow
  transitions, high-craft micro-interactions, quiet material chrome, and
  browser-engine paint hygiene.

## Standing Stance

Apply these defaults unless the user or codebase explicitly dictates otherwise:

1. **Critically damped, velocity-preserving springs (`bounce: 0`).**
   Parameterize springs with SwiftUI's `(duration, bounce)` mapping (`ω = 2π/d`,
   `ζ = 1 - b`) and default `bounce: 0`. Polish comes from smooth mid-flight
   reversals that preserve velocity, not cartoon overshoot. Reserve small bounce
   only for playful toys, never structural chrome.
2. **State owns targets; motion owns displayed values.**
   Run springs on one shared `requestAnimationFrame` loop with strict
   `read`-before-`write` batching, writing directly to DOM styles. Never tick
   reactive framework state on every animation frame, and never spin up
   per-component `rAF` loops that interleave layout reads with style writes.
3. **Eliminate layout reflow during transitions ("the reflow stutter").**
   Never let text re-wrap frame-by-frame while a sidebar or drawer animates, and
   never hardcode `sidebarWidth / 2` offsets that break on resize or side
   panels. Measure the landing width *once* at flight start, hold it via a
   non-inheriting CSS custom property (`--panel-hold-width`), and translate only
   in-view centered/end-aligned blocks along the flight's progress.
4. **Never overlap morphing faces ("the double-exposure smear").**
   When a container switches between modes (composer input ↔ queue ↔ question
   card), morph it as one surface on a single height spring and slice outgoing
   and incoming faces to their own boxes with `clip-path` so two faces never
   draw over each other. For in-place swaps (steppers, button labels), use
   restrained blur (`≤ 2px`) + tiny scale (`0.97`) + initial velocity launch
   (`0.3`) instead of wide horizontal slides.
5. **Model transitions as pure state machines, not `setTimeout` flags.**
   Any interaction with overlapping phases (rolling digits, shimmer fade-out,
   panel flights, sidebar peek, multi-step switchers) gets a pure
   `(state, event) -> { state, effects }` reducer. Rapid toggling, unmount
   cleanup, and `prefers-reduced-motion` become deterministic instead of racy.
6. **Keep ambient motion off the main thread and in phase.**
   Never animate `background-position` on `background-clip: text` for shimmers
   ("the CPU shimmer trap") - counter-translate a masked window and inner text
   purely via compositor `translate`, and fade the sweep out when idle instead
   of snapping off. Keep concurrent spinners in **lockstep phase** (single
   masked APNG or `animation.startTime = 0`), never staggered, and pause them
   via `IntersectionObserver` when scrolled offscreen.
7. **Sweat digit, wrap, and scrollbar gotchas.**
   - **Rolling numbers**: key by place value; reserve a hidden leading zero for
     smooth `ch` width carry; apply top/bottom fade masks *only while rolling*;
     draw visual digits via `::before { content: attr(...) }` inside
     `aria-hidden="true"` with one `.sr-only` node so copy/screen readers never
     read duplicate digits; morph plural suffixes (`1 file → 2 files`) instead
     of snapping them.
   - **Text wrapping**: `text-wrap-style: pretty` on prose, `auto` on
     `code, pre`, and **`stable` on `input, textarea, [contenteditable]`** so
     earlier lines never jump while typing.
   - **Scrollbars**: never set `scrollbar-width`/`scrollbar-color` alongside
     `::-webkit-scrollbar` ("the Chromium scrollbar blackout") - gate standard
     properties in `@supports not selector(::-webkit-scrollbar)`, gate custom
     scrollbars to `(hover: hover) and (pointer: fine)`, and trigger hover
     reveal with a non-inherited `@property --scrollbar-hover`.
8. **Quiet material chrome over glossy effects.**
   Default to pure neutral greyscale chrome so color carries semantic meaning
   (status, diffs, focus, agent roles). Build depth with `0.5px` crisp rings and
   dark-mode `-0.5px` top catchlights rather than opaque borders or heavy blur
   glass. Use variable-font optical micro-weights (`440` regular / `530` medium)
   with tight tracking, stacked translucent overlay gradients for uniform
   hover/press states across variants, `cursor: default` on app chrome/menus,
   and negative-margin `data-flush` optical alignment on borderless buttons.
9. **Inspect motion in slow motion (`0.25×`).**
   When building a custom motion controller, expose a global time-scale
   multiplier (e.g. `motionTimeScale()`) so transitions can be inspected at
   `0.25×`. Every seam invisible at `1×` - overlapping text, premature fades,
   subpixel snaps - jumps out immediately at quarter speed.

## Named Anti-Patterns to Catch

| Anti-pattern | What it looks like | Fix |
|---|---|---|
| **CPU shimmer trap** | `background-clip: text` + `@keyframes { background-position }` | Counter-translating masked window + inner text (`translate` only) + fade-out state |
| **Chromium scrollbar blackout** | Setting `scrollbar-width: thin` globally alongside `::-webkit-scrollbar` | Gate `scrollbar-width` in `@supports not selector(::-webkit-scrollbar)`; use `@property` for hover repaint |
| **Hardcoded half-shift** | Translating content by `sidebarWidth / 2` | Lock `--panel-hold-width` once at flight start; translate only blocks that actually move |
| **Resting mask blur** | Leaving top/bottom `mask-image` fade on rolling digits at rest | Apply mask strictly under `[data-animating="true"]` |
| **Subpixel settle snap** | Composited `transform` on rolling digit strip jumping 0.5px on settle | Animate `top` while rolling; swap to static glyph at rest |
| **Double-exposure morph** | Crossfading two faces at the same `top: 0` without clipping | Slice each face to its animated box with `clip-path: inset(...)` |
| **Ghost text copy** | Mounting old + new digit text nodes during a flip | Render leaving digits via `::before { content: attr(data-leaving) }` or `.sr-only` + `aria-hidden` |
| **Desynced spinner soup** | Staggering `animation-delay` across 15 parallel spinners | Lock all spinners to one phase (`startTime = 0` or shared APNG mask) + offscreen pause |

## References

Read the relevant reference *before* writing code in that area:

| When the task involves… | Read |
|---|---|
| Springs, shared `rAF` read/write loop, zero-reflow sidebars, `clip-path` height morphing, transition state machines, or slow-mo tuning | [references/motion-physics.md](references/motion-physics.md) |
| Rolling/odometer counters, plural suffix morphing, interruptible steppers, GPU text shimmer, phase-locked spinners, safe-triangle flyouts, or edge-peek corridors | [references/micro-interactions.md](references/micro-interactions.md) |
| Light/dark neutral tokens, `0.5px` elevation + dark catchlights, button hover overlays, variable font micro-weights, `text-wrap-style`, flush alignment, or Chromium-safe hover scrollbars | [references/surfaces-and-chrome.md](references/surfaces-and-chrome.md) |
