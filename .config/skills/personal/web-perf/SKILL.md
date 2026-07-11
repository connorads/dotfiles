---
name: web-perf
description: >-
  Diagnose and fix first-load visual jank users can see - font-swap flashes,
  image decode pop-in, layout shift, blank-then-paint, SSR/hydration flips,
  slow/janky first paint - on any hand-wired stack: static-prerendered
  (Astro/SSG), Vite SPA/MPA, or SSR from a Worker/edge. Use when the user
  reports a "flash", "shimmer", "pop", "jump", "flicker", or slow first paint;
  when reviewing font or image loading; when deciding whether subsetting fixed
  copy is safe; when wiring resource hints (preload/preconnect) or metric-matched
  fallbacks by hand; or when asserting first-load invariants on built HTML. Not
  for backend latency, bundle-size analysis, or runtime interaction (INP)
  tuning; defer to a framework's own font/image layer (next/font, next/image)
  where it automates the fix.
---

# Web Performance: first-load visual jank

Diagnose and fix the first-load defects a user can *see* (font-swap flashes,
image pop-in, layout shift, blank-then-paint, hydration flips, slow first paint)
on any stack where you hand-wire loading instead of leaning on a framework's
font/image layer. That spans static-prerendered sites (Astro/SSG), Vite
SPA/MPA, and SSR from a Worker/edge: `@font-face` written by hand, native
`<img>`, resource hints in your own document head. The framework is not doing it
for you, so you must - and must verify it yourself.

Where a framework *does* automate the fix (Next's `next/font`/`next/image`),
defer to it and stop (`references/framework-automation.md`).

## Out of scope

This skill owns **first-load visual jank** and nothing wider. Not here: backend
/ TTFB latency, bundle-size analysis (tree-shaking, chunk budgets), runtime
interaction tuning (INP beyond the hydration flip), or SEO. Those are separate
concerns; do not grow this skill into them. If the ask is one of those, say so
and stop rather than stretching a loading fix to fit.

## The core loop: symptom -> cause -> fix -> proof

You almost always arrive with a **symptom the user saw** (or a screenshot), not
a metric. So the spine is diagnostic. For each symptom: name the cause, apply
the fix, then **prove it cold-cache** - an unverified perf fix is a guess.

First ask: **is the HTML fixed at build (static prerender) or rendered per
request (SSR)?** It rules out whole symptom classes and picks how you verify ->
`references/static-vs-ssr.md`. Then:

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
  block"; the fixes differ. **Measure the real artifact before trusting a generic
  ratio** - the "300KB -> 20KB" subsetting win assumes an unsubset source; an
  already-subset file has most of it banked (fonts.md).
- **Degradation** - no-JS, `prefers-reduced-motion`, slow-3G, and the nasty one:
  **cache-hit before hydration** (a cached image/handler race). A fix that only
  works with warm cache and attached JS is not a fix. (Worked example: a JS
  `onLoad` image fade fails here; CSS entrance + eager load degrades safely.)
- **Edge / privacy** - where the response is assembled per request (SSR at an
  edge/Worker, locale or A/B branching), any pre-auth/pre-gate anonymity
  constraint limits what you may preload or inline before the user is
  identified. Generic perf advice ignores this - and it bites 103 Early Hints,
  which can leak cached preload URLs ahead of an auth check (resource-hints.md).
  Under full static prerender there is no per-request edge logic, so this lens
  mostly collapses.

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
- On React stacks, the DOM resource-hint APIs (`preload`, `preconnect`,
  `prefetchDNS`) have their own reference in
  `vercel-react-best-practices/rules/rendering-resource-hints.md`; this skill is
  framework-agnostic and adds the *why* (crossOrigin/CORS, exact-file matching,
  ordering/priority) that the API table omits. On other stacks you write the
  same `<link>` tags into your own head - the *why* is identical.

## References

**Diagnose:**

- `references/symptoms.md` - the diagnostic decision tree (spine). START HERE.

**Fix:**

- `references/fonts.md` - self-hosted font loading: per-weight preload,
  crossOrigin, exact-file (`?url`) matching, metric-matched fallbacks,
  `font-display`, variable fonts, subsetting.
- `references/images.md` - eager/lazy, decode timing, priority/discovery, CLS
  reservation, responsive `srcset`/`<picture>`, LQIP, content-visibility.
- `references/resource-hints.md` - preload/preconnect ordering & priority,
  crossOrigin, exact-file matching, budget, 103 Early Hints, repeat-view cache
  headers (with clearly-labelled stack-specific subsections for
  Vite/Cloudflare/TanStack).

**Decide where:**

- `references/static-vs-ssr.md` - the fixed-at-build vs rendered-per-request
  axis: which symptom classes are possible, and which verify tier applies.
- `references/framework-automation.md` - what a framework's font/image layer
  automates <-> the hand-rolled equivalent.

**Prove:**

- `references/verify.md` - how to prove a fix cold-cache: Tier 0 asserts on the
  static `dist/*.html` bytes; Tier 1 boots the route for SSR; shared CLS probe +
  measurement-tool gotchas. The lens no other loading skill carries.

**Templates (read-as-reference, brand-agnostic - adapt per project):**

- `scripts/check-dist.mjs` - Tier-0 build-output guard: preload budget,
  crossorigin, preload<->@font-face href match, no stylesheet link, metric
  fallback presence, subset byte ceilings, scoped glyph coverage, immutable cache
  headers. Wire into CI after the build.
- `scripts/font-subset.config.mjs` - the single shared coverage module the subset
  generator and `check-dist.mjs` both import, so the shipped woff2 and the
  assertion can't drift.

`evals/` holds the behaviour eval set (see writing-skills); it is intentionally
not routed from the workflow above.
