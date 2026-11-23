# Micro-Interaction Recipes

Concrete patterns for rolling numbers, animated plurals, GPU shimmers,
phase-locked spinners, and pointer-forgiving desktop geometry.

## 1. Two Rolling-Number Architectures (Pick by Job)

Use **tabular numerals** (`font-variant-numeric: tabular-nums`) and lock digit
order in RTL (`direction: ltr; unicode-bidi: isolate`).

### A. Odometer Counter (Live Incrementing Totals: `Read 1 → 2 → 10 files`)

For counts that tick upward/downward during activity:

1. **Key digits by place value** (most significant first: `[places-1 ... 0]`) so
   existing place-value boxes stay anchored across carries (`9 → 10`).
2. **Spare leading zero for smooth width carry**: keep one extra leading zero
   outside the clipped `width: <digits>ch` box (`justify-content: flex-end;
   overflow: hidden`). When `9 → 10`, transition the box `width`
   (`560ms cubic-bezier(0.22, 1, 0.36, 1)`) while rolling the spare `0 → 1` into
   view. When shrinking (`10 → 9`), keep the leaving digit mounted until the
   width shrinks past it.
3. **Avoid `9 → 0` reverse rewind**: use a multi-decade strip (e.g. 30 cells of
   `0..9` repeated) so incrementing from `9` to `0` rolls forward into the next
   decade, then resets silently to the middle decade when `transitionend` fires.
4. **Animate `top`, not `transform`**: a GPU-composited `transform` roll snaps
   by ~0.5px when its layer demotes on settle. Animate `position: relative; top`
   on the strip while `[data-animating="true"]`, hide the strip at rest, and
   show a crisp static glyph at rest.
5. **Mask strictly while rolling**: apply the vertical fade mask *only* under
   `[data-animating="true"]` - leaving it on at rest dims the top and bottom
   edges of static glyphs.
6. **Zero duplicate text for copy & screen readers**: render all visual digits
   via `::before { content: attr(data-digit) }` inside `aria-hidden="true"`, and
   put the plain number once inside `<span class="sr-only">{value}</span>`.

```css
[data-component="animated-number"] {
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}
[data-slot="animated-number-value"] {
  display: inline-flex;
  direction: ltr;
  justify-content: flex-end;
  width: var(--animated-number-width, 1ch);
  overflow: hidden;
}
[data-slot="animated-number-value"][data-resizing="true"] {
  transition: width 560ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-slot="animated-number-digit"] {
  display: inline-grid;
  flex-shrink: 0;
  width: 1ch;
  height: 1em;
  line-height: 1em;
  overflow: hidden;
}
[data-slot="animated-number-digit"][data-animating="true"] {
  mask-image: linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%);
}
[data-slot="animated-number-static"],
[data-slot="animated-number-strip"] {
  grid-area: 1 / 1;
}
[data-slot="animated-number-static"]::before,
[data-slot="animated-number-cell"]::before {
  content: attr(data-digit);
}
[data-slot="animated-number-digit"][data-animating="true"] [data-slot="animated-number-static"],
[data-slot="animated-number-digit"][data-animating="false"] [data-slot="animated-number-strip"] {
  visibility: hidden;
}
[data-slot="animated-number-strip"] {
  display: inline-flex;
  flex-direction: column;
  position: relative;
  top: calc(var(--animated-number-offset, 10) * -1em);
  transition: top 600ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

### B. Animated Plural Suffix (`1 file` ↔ `2 files`)

Split singular/plural forms into common stem + variable suffix (when one starts
with the other). Animate the suffix in/out instead of snapping it:

```css
[data-slot="count-suffix"] {
  display: inline-grid;
  grid-template-columns: 0fr;
  opacity: 0;
  filter: blur(0.84px);
  overflow: hidden;
  transform: translateX(-0.04em);
  transition:
    grid-template-columns 250ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 250ms ease-out,
    filter 250ms ease-out,
    transform 250ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-slot="count-suffix"][data-active="true"] {
  grid-template-columns: 1fr;
  opacity: 1;
  filter: blur(0);
  transform: translateX(0);
}
[data-slot="count-suffix-inner"] {
  min-width: 0;
  overflow: hidden;
  white-space: pre;
}
```

### C. Interruptible Spring Stepper (`1 / 4` → `2 / 4`)

For interactive steppers driven by fast clicks or arrow keys:

- Render each place value as a `display: inline-grid; overflow-y: clip` cell
  holding two stacked glyphs at `grid-area: 1 / 1`: the live `incoming` node
  (holds the actual text) and an `aria-hidden="true"` `outgoing` node drawing
  its glyph via `[data-leaving]::before { content: attr(data-leaving) }`.
- Drive both glyphs on one bounce-free spring (`duration: 0.375, bounce: 0`)
  running `0 → 1`, writing `translate3d(0, offset*100%, 0)` and
  `opacity = 1 - min(1, |offset|)`.
- **Mid-roll reversal**: if the next value equals the still-leaving digit,
  reverse directly from their current offsets so the leaving digit slides back
  into center instead of restarting from the edge.

## 2. Counter-Translating GPU Text Shimmer

Animating `background-position` on `background-clip: text` forces the browser to
repaint text on every frame. Instead, stack a base layer and a shimmer layer in
`grid-area: 1 / 1`, and move a soft-masked highlight window forward while
translating the peak-colored text inside it **backward by the exact same
distance**. Both are compositor-only `translate` animations (zero paint):

```css
[data-component="text-shimmer"] {
  --shimmer-duration: 1200ms;
  --shimmer-spread: 5.2ch;
  --shimmer-gutter: calc(var(--shimmer-spread) + 1ch);
  --shimmer-swap: 220ms;
  display: inline-grid;
}
[data-slot="shimmer-base"],
[data-slot="shimmer-layer"] {
  grid-area: 1 / 1;
  white-space: pre;
  transition: opacity var(--shimmer-swap) ease-out;
}
[data-slot="shimmer-layer"] {
  position: relative;
  overflow: clip;
  color: var(--text-muted);
  opacity: 0;
}
[data-component="text-shimmer"][data-active="true"] [data-slot="shimmer-base"] { opacity: 0; }
[data-component="text-shimmer"][data-active="true"] [data-slot="shimmer-layer"] { opacity: 1; }

[data-slot="shimmer-sweep"] {
  position: absolute;
  inset: 0 calc(-1 * var(--shimmer-spread));
  pointer-events: none;
  user-select: none;
  mask-image: linear-gradient(
    90deg,
    transparent calc(50% - var(--shimmer-spread)),
    #000 50%,
    transparent calc(50% + var(--shimmer-spread))
  );
  animation: shimmer-window var(--shimmer-duration) linear infinite both;
}
[data-slot="shimmer-sweep-text"] {
  display: block;
  margin-inline: var(--shimmer-spread);
  color: var(--text-base);
  animation: shimmer-text var(--shimmer-duration) linear infinite both;
}

@keyframes shimmer-window {
  from { translate: calc(-50% + var(--shimmer-spread) - var(--shimmer-gutter)) 0; }
  to   { translate: calc(50% - var(--shimmer-spread) + var(--shimmer-gutter)) 0; }
}
@keyframes shimmer-text {
  from { translate: calc(50% + var(--shimmer-gutter)) 0; }
  to   { translate: calc(-50% - var(--shimmer-gutter)) 0; }
}
```

- **Smooth deactivation**: use a 3-state machine (`inactive | active | fading`).
  When `active` turns `false`, crossfade back to `shimmer-base` over `220ms`
  while keeping the sweep running (`data-run="true"`), then stop the sweep once
  the fade settles. Never snap the shimmer off in one frame.
- Under `prefers-reduced-motion: reduce`, hide the sweep and keep `shimmer-base`
  at `opacity: 1`.

## 3. Phase-Locked Spinners & Offscreen Pause

Lists of 10-20 parallel tasks look chaotic when spinners rotate out of phase and
burn CPU if each spinner has dozens of animated SVG nodes.

- **Best option (zero CSS animations)**: render a single `<span>` whose
  `mask-image` is a pre-rendered monochrome APNG (`background: currentColor`).
  Every instance shares one browser decode loop, stays in lockstep with zero JS,
  and costs zero main-thread style recalculations.
- **CSS/SVG spinner fallback**: keep each spinner to one rotating element,
  **never stagger** `animation-delay` across rows, and pin every infinite
  animation to the document timeline origin (`animation.startTime = 0`) on
  mount/resize/`animationstart` in a single coalesced `rAF` pass.
- **Pause when offscreen**: attach a shared `IntersectionObserver` that toggles
  `data-offscreen` (mapped to `animation-play-state: paused`) when a spinner is
  scrolled or clipped out of view, then re-pins `startTime = 0` when it returns.
- Distinguish **AI/agent activity** (e.g., soft radar/dot matrix) from generic
  **network/app loading** (simple ring loader).

## 4. Pointer-Forgiving Desktop Geometry

### Safe Triangle for Submenu Flyouts

When moving diagonally from a menu row into its open submenu, the pointer
crosses neighbouring rows. Don't let those rows steal focus immediately:

- Record the pointer's last position on the owning row as the triangle `apex`.
- Compute the triangle from `apex` to the flyout's near top and bottom corners
  (`box.left > apex.x ? box.left : box.right`).
- While pointer moves stay inside that triangle (cross-product sign test), hold
  the current flyout open and start a `300ms` settle timer - if the user stops
  resting on the neighbouring row, hand over; if they reach the flyout, cancel
  the timer.

### Edge-Peek Sidebar Corridor + Seamless Dock Handoff

- Hovering the collapsed sidebar's toggle or window start-edge gutter peeks the
  real sidebar over content on a quicker spring (`0.18s`, `bounce: 0`).
- Measure the **corridor bounding box** spanning both the toggle button and the
  peeked sheet, padded by ~`15px`, so travelling from toggle into sidebar never
  collapses the peek.
- Keep the peek open while typing in a sidebar input, dragging, or while a
  context menu is open.
- Clicking dock mid-peek keeps the sidebar right where it is and hands off to
  the docked panel spring seamlessly instead of closing and reopening.
