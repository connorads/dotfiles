---
name: web-perf
description: >-
  Diagnose and fix first-load visual jank users can see - font-swap flashes,
  image decode pop-in, layout shift (CLS), slow LCP/FCP, blank-then-paint,
  hydration/theme flips, Core Web Vitals or Lighthouse/PageSpeed complaints
  about first paint - on any hand-wired stack: static-prerendered (Astro/SSG),
  Vite SPA/MPA, or SSR from a Worker/edge. Use when the user reports a
  "flash", "shimmer", "pop", "jump", "flicker", or slow first paint; when
  reviewing font loading (self-hosted or hosted CDN like Google Fonts) or
  image loading; when deciding whether subsetting fixed copy is safe; when
  wiring resource hints (preload/preconnect) or metric-matched fallbacks by
  hand; or when asserting first-load invariants on built HTML or a booted
  route. Not for backend latency, bundle-size analysis, or runtime
  interaction (INP) tuning; where a framework layer automates the fix
  (next/font, next/image, Astro 6 fonts), defer to that layer's own output -
  but still inspect app code wrapping it.
---

# Web Performance: first-load visual jank

Diagnose and fix the first-load defects a user can *see* (font-swap flashes,
image pop-in, layout shift, blank-then-paint, hydration flips, slow first paint)
on any stack where you hand-wire loading instead of leaning on a framework's
font/image layer. That spans static-prerendered sites (Astro/SSG), Vite
SPA/MPA, and SSR from a Worker/edge: `@font-face` written by hand, fonts pulled
from a hosted CDN (Google Fonts), native `<img>`, resource hints in your own
document head. The framework is not doing it for you, so you must - and must
verify it yourself.

Where a framework *does* automate the fix (Next's `next/font`/`next/image`,
Astro 6's Fonts API), defer to that layer's own output - but app code
*wrapping* it stays in scope (`references/framework-automation.md`).

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
request (SSR)?** - per route, not per site. The axis picks how you *verify*
and which build-time gates exist; whether a symptom class is *possible* hinges
on client-reconciliation JS, not on the axis ->
`references/static-vs-ssr.md`. Then:

1. Identify the symptom -> `references/symptoms.md` (decision tree). START HERE.
2. Apply the matching fix ->
   `references/{fonts,hosted-fonts,images,resource-hints}.md`.
3. Prove it -> `references/verify.md`. This step is not optional. Half the value
   of a loading fix is the repeatable check that it actually landed.

Tag each fix by the **Web Vital it moves** (LCP / CLS / INP / TTFB / FCP) as a
secondary index - useful when the ask does arrive as "improve CLS", and for
knowing which fixes trade against each other.

**Triage root question**: does layout MOVE, does only APPEARANCE change, or
does NOTHING appear yet? That routes the whole diagnosis - the full tree,
causes and fixes live in `references/symptoms.md`.

## Sanity checks the obvious fix tends to miss

- **Cache-hit-before-hydration**: a fix that needs attached JS (an `onLoad`
  fade, a JS-decoded placeholder) fails when a cached image wins the race
  against hydration - and with no-JS. Prefer CSS + eager loading; check
  degradation (`prefers-reduced-motion`, Slow-3G) before calling it done.
- **Edge/privacy leak**: where the response is assembled per request, pre-auth
  anonymity limits what you may preload or inline - 103 Early Hints can replay
  cached preload URLs ahead of an auth check (resource-hints.md). Collapses
  under full static prerender.
- **Bytes vs blocking vs main-thread**: "make it smaller" (subset/compress),
  "make it not block" (preload/inline/reorder) and "get it off the main
  thread" (defer/split) are different fixes; name which one you are applying.
- **Measure before promising a ratio**: the "300KB -> 20KB" subsetting win
  assumes an unsubset source; an already-subset file has most of it banked.
  Measure the real artifact first (fonts.md).
- **Trade-off regression**: eager/preload/fetchpriority are zero-sum on
  bandwidth - after a fix, re-check the vital you might have regressed
  (verify.md).

## Boundaries and cross-references

- Where Next automates the row, defer to `next/font`/`next/image` output - but
  still inspect app code wrapping it (fade wrappers, raw `font-family`
  re-declarations); see `references/framework-automation.md`.
- Embedded / host-owned surfaces (MCP widgets, Devvit iframes, CSP-forced
  single-file): the host owns `<head>`/headers, so hint/cache levers don't
  apply - see the boundary note in `references/static-vs-ssr.md`.
- Animation design (easing, entrance curves, reduced-motion gating, stagger)
  is the `web-animation-design` skill; this skill only owns the loading/decode
  timing that determines whether there is a real image to animate.
- `will-change`, transitions, tabular-nums, text-wrap live in the
  `make-interfaces-feel-better` skill.
- On React stacks, the DOM resource-hint APIs (`preload`, `preconnect`,
  `prefetchDNS`) are tabulated in the `vercel-react-best-practices` skill;
  this skill adds the framework-agnostic *why* (crossOrigin/CORS, exact-file
  matching, ordering/priority).

## References

**Diagnose:**

- `references/symptoms.md` - the diagnostic decision tree (spine). START HERE.

**Fix:**

- `references/fonts.md` - self-hosted font loading: per-weight preload,
  crossOrigin, exact-file (`?url`) matching, metric-matched fallbacks,
  `font-display`, variable fonts, subsetting.
- `references/hosted-fonts.md` - fonts from a hosted CDN (Google Fonts):
  preconnect pair, `display=` param, `@import` chains, why gstatic woff2 can't
  be hand-preloaded, migrate-to-self-host.
- `references/images.md` - eager/lazy, decode timing, priority/discovery, CLS
  reservation, responsive `srcset`/`<picture>`, Astro anti-patterns, GIF->video,
  LQIP, content-visibility.
- `references/resource-hints.md` - preload/preconnect ordering & priority,
  crossOrigin, exact-file matching, budget, 103 Early Hints, repeat-view cache
  headers + bfcache (with stack-specific subsections for
  Vite/Cloudflare/TanStack).

**Decide where:**

- `references/static-vs-ssr.md` - the fixed-at-build vs rendered-per-request
  axis (per route): which verify tier applies, per-route hybrids, embedded
  surfaces.
- `references/framework-automation.md` - what a framework's font/image layer
  automates <-> the hand-rolled equivalent, and the wrapping-code carve-out.

**Prove:**

- `references/verify.md` - how to prove a fix cold-cache: Tier 0 asserts on the
  static `dist/*.html` bytes; Tier 1 boots the route for SSR; shared CLS probe +
  measurement-tool gotchas. The lens no other loading skill carries.

**Templates (read-as-reference, brand-agnostic - adapt per project):**

- `scripts/check-dist.mjs` - Tier-0 build-output guard: preload budget range,
  crossorigin, preload<->@font-face href match, no stylesheet link, metric
  fallback presence, subset byte ceilings, scoped glyph coverage, immutable +
  public-font cache headers. Wire into CI after the build.
- `scripts/check-head.mjs` - Tier-1 booted-route guard: fetch a route (or pipe
  HTML in) and assert the same head invariants on rendered bytes.
- `scripts/font-subset.config.mjs` - the single shared coverage module the subset
  generator and `check-dist.mjs` both import, so the shipped woff2 and the
  assertion can't drift.

`evals/` holds the behaviour eval set (see writing-skills); it is intentionally
not routed from the workflow above.
