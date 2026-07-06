---
name: first-load-web-perf
description: >-
  Diagnose and fix first-load visual jank - font-swap flashes, image decode
  pop-in, layout shift, blank-then-paint, SSR/hydration flips - on hand-rolled
  (non-Next) React apps built with Vite and served from the edge (Cloudflare
  Workers or similar). Use when the user reports a "flash", "shimmer", "pop",
  "jump", "flicker", or slow/janky first paint; when reviewing font or image
  loading; or when wiring resource hints (preload/preconnect) and metric-matched
  fallbacks by hand instead of via a framework. NOT for Next.js - defer to
  next-best-practices there.
---

# First-Load Web Performance (hand-rolled stacks)

The **manual-stack counterpart** to the Next.js loading guidance. On Next,
`next/font` and `next/image` solve most of what follows automatically -
metric-matched fallbacks, per-weight preload, priority/lazy, CLS reservation -
so on Next you defer to `next-best-practices/{font,image}.md` and stop.

Reach here when you are hand-wiring loading: fontsource + `@font-face`, native
`<img>`, resource hints written into your own document head, SSR from a Worker.
The framework is not doing it for you, so you must - and must verify it yourself.

## The core loop: symptom -> cause -> fix -> proof

You almost always arrive with a **symptom the user saw** (or a screenshot), not
a metric. So the spine is diagnostic. For each symptom: name the cause, apply
the fix, then **prove it cold-cache** - an unverified perf fix is a guess.

1. Identify the symptom -> `references/symptoms.md` (decision tree). START HERE.
2. Apply the matching fix -> `references/{fonts,images,resource-hints}.md`.
3. Prove it -> `references/verify.md`. This step is not optional. Half the value
   of a loading fix is the repeatable check that it actually landed.

Tag each fix by the **Web Vital it moves** (LCP / CLS / INP / TTFB / FCP) as a
secondary index - useful when the ask does arrive as "improve CLS", and for
knowing which fixes trade against each other.

## Lenses (apply more than one)

A first-load problem looks different through each lens; a fix that satisfies one
can regress another. Run the symptom lens first, then sanity-check the others.

- **Symptom** (primary) - what the user sees: shimmer, flash, pop-in, jump,
  blank-then-paint, hydration flip. How problems actually present.
- **Web Vital moved** - LCP / CLS / INP / TTFB / FCP. Secondary index; also names
  the trade-offs (e.g. eager-loading a decorative image spends bandwidth the LCP
  element wanted).
- **Timeline / waterfall** - *when* in the load: preconnect -> SSR head ->
  critical CSS -> font swap -> image decode -> hydrate. Most "hint fired too
  late" and ordering bugs only make sense on this axis.
- **Bytes vs blocking vs main-thread** - is the cost download size (subset /
  compress), render-blocking (preload / inline / reorder), or JS on the main
  thread (defer / split)? People conflate "make it smaller" with "make it not
  block"; the fixes differ.
- **Degradation** - no-JS, `prefers-reduced-motion`, slow-3G, and the nasty one:
  **cache-hit before hydration** (a cached image/handler race). A fix that only
  works with warm cache and attached JS is not a fix. (Worked example: a JS
  `onLoad` image fade fails here; CSS entrance + eager load degrades safely.)
- **Edge / privacy** (stack-specific) - SSR-in-locale via middleware; and any
  pre-auth/pre-gate anonymity constraint limits what you may preload or inline
  before the user is identified. Generic perf advice ignores this - and it bites
  103 Early Hints, which can leak cached preload URLs ahead of an auth check
  (resource-hints.md).

## Triage: does layout MOVE, only APPEARANCE change, or does NOTHING appear yet?

That root question routes the whole diagnosis (full tree + fixes in
`symptoms.md`). Quick map:

- **Layout MOVES (measurable shift -> CLS).** Webfont load with a
  metric-mismatched fallback; an image/iframe with no reserved box; late-injected
  content (banner/consent/ad); a size mismatch that shifts once at hydration.
  Fixes: metric-matched `@font-face` fallback; reserve the box
  (`aspect-ratio`/dims - note CSS rotation is a transform, so reserve the
  *un-rotated* box); reserve space for late content; make the value server-knowable.
- **Only APPEARANCE changes (no shift).** FOIT (invisible text, `font-display`);
  FOUT weight *shimmer* on an un-preloaded weight (Tailwind `font-medium`->500,
  `font-semibold`->600 - if only 400 is preloaded, those swap); FOUC from late
  CSS; icon-font tofu; an image popping to opacity 1 on lazy decode; a
  theme/active-state flip at hydration. Fixes: preload the exact above-the-fold
  weight; `font-display: swap`; keep critical CSS render-blocking; inline SVG
  sprites; `loading="eager"` (not `decoding` - see images.md); reconcile SSR vs
  client state via a cookie.
- **NOTHING appears yet (blank-then-paint -> FCP/LCP).** Render-blocking CSS/JS
  or a heavy hydration bundle; a late-discovered LCP image (CSS background, lazy,
  or JS-injected). Fixes: ship SSR HTML, defer non-critical JS/CSS;
  `fetchpriority="high"` on the real LCP image, never lazy-load it.
- **Jank during scroll/interaction (not first paint).** Heavy paint on long
  pages -> `content-visibility: auto` (+ `contain-intrinsic-size`).

## Boundaries and cross-references

- Animation design (easing, entrance from `scale(0.96)` not `scale(0)`,
  reduced-motion gating, stagger) is **already covered** by
  `web-animation-design`. This skill only owns the *loading/decode timing* that
  determines whether there is a real image to animate. Cross-reference, do not
  duplicate.
- `will-change`, `transition` specificity, tabular-nums, text-wrap live in
  `make-interfaces-feel-better/{performance,typography}.md`.
- React DOM resource-hint APIs (`preload`, `preconnect`, `prefetchDNS`) are in
  `vercel-react-best-practices/rules/rendering-resource-hints.md` - this skill
  adds the *why* (crossOrigin/CORS, exact-file matching, ordering/priority) that
  skill omits.

## References

- `references/symptoms.md` - the diagnostic decision tree (spine). START HERE.
- `references/verify.md` - how to prove a fix cold-cache (runnable Playwright CLS
  probe + head-count gate). The lens no other loading skill carries.
- `references/fonts.md` - self-hosted font loading (fontsource + Vite): per-weight
  preload, crossOrigin, `?url`, metric-matched fallbacks, `font-display`, variable
  fonts.
- `references/images.md` - eager/lazy, decode timing, priority/discovery, CLS
  reservation, responsive `srcset`/`<picture>`, LQIP, content-visibility.
- `references/resource-hints.md` - preload/preconnect ordering & priority,
  crossOrigin, `?url` matching, budget, 103 Early Hints, TanStack Start head.
- `references/next-vs-manual.md` - what next/font & next/image automate <-> the
  hand-rolled equivalent.
