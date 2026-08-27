---
name: web-perf
description: >-
  Diagnoses and fixes what a user sees on a route's first load - font-swap
  flashes, image decode pop-in, layout shift (CLS), slow LCP/FCP,
  blank-then-paint, hydration/theme flips, streamed-SSR skeletons that flash
  or pop, Lighthouse/PageSpeed complaints - on static (Astro/SSG), Vite SPA,
  SSR, or streamed routes (Next.js App Router/PPR, TanStack Start); a soft
  navigation is that route's first load. Use on "flash", "shimmer", "pop",
  "jump", "flicker", "skeleton", or slow first paint; when the LCP is webfont
  text or content fades in after JS; for font loading (self-hosted, Google
  Fonts, Adobe Fonts, next/font), image loading (next/image), Suspense
  boundary placement, skeleton swaps, subsetting fixed copy, resource hints,
  metric fallbacks; or to assert first-load invariants on built HTML, a
  booted route, or a streamed shell. Not for bundle-size analysis,
  steady-state INP, SEO, or backend latency past the TTFB-vs-skeleton
  trade-off; where a framework automates the fix, defer to its output but
  inspect wrapping code.
---

# Web Performance: the first load of a route

Diagnose and fix what a user *sees* on a route's first load. Two territories:

- **Hand-wired loading** - `@font-face` written by hand, fonts pulled from a
  hosted CDN (Google Fonts), native `<img>`, resource hints in your own
  document head. No framework layer is doing it for you, so you must - and
  must verify it yourself.
- **The rendering path itself** - streamed shells, Suspense fallbacks and the
  skeleton-to-content swap, hydration timing, router-level pending states.
  Here the framework's rendering model *is* the mechanism, and the lever is
  where you place boundaries and what the fallback reserves.

Where a framework *does* automate the fix (Next's `next/font`/`next/image`,
Astro's Fonts API), defer to that layer's own output - but app code
*wrapping* it stays in scope (`references/framework-automation.md`).

## Out of scope

This skill owns **the first-load experience of a route** - everything the user
sees between requesting a route and its settled first view, whoever produced
the HTML. A soft navigation counts as the next route's first load, and a
Suspense-boundary placement counts even though it shapes TTFB. Still not here:

- **Bundle-size analysis** (tree-shaking, chunk budgets, dependency audits).
  Naming a large hydration bundle as a C1 *cause* is in scope; auditing and
  shrinking it is not.
- **Steady-state interaction (INP) tuning** - interaction latency after the
  route has settled. Hydration timing is in scope only where it changes what
  the user sees arriving.
- **SEO** - the head is shared plumbing; title/canonical/robots concerns
  belong elsewhere (the status-freeze soft-404 note in static-vs-ssr.md is a
  first-load fact, not SEO advice).
- **Backend latency** beyond the TTFB-vs-skeleton-vs-blank boundary
  trade-off - making the query faster is not this skill.

If the ask is one of those, say so and stop rather than stretching a loading
fix to fit.

## The core loop: symptom -> cause -> fix -> proof

You almost always arrive with a **symptom the user saw** (or a screenshot), not
a metric. So the spine is diagnostic. For each symptom: name the cause, apply
the fix, then **prove it cold-cache** - an unverified perf fix is a guess.

First ask: **how does the HTML reach the browser - fixed at build (static
prerender), rendered per request (SSR), or streamed (a shell, then
flushes)?** - per route, not per site (per *hole* under Cache Components). The
axis picks how you *verify* and which build-time gates exist; whether a symptom
class is *possible* hinges on client-reconciliation JS, not on the axis ->
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
- **Reveal-gating**: if everything fades in, ask what actually paints first.
  CSS that ships content at `opacity: 0` until client JS reveals it turns
  first paint into a JS race, never paints with no-JS, and delays LCP
  (opacity-0 content is excluded from the metric). The entrance must be an
  enhancement, not the delivery mechanism (symptoms.md B7). But un-gating the
  reveal can make LCP *fire* without moving the score - the paint may still be
  bound elsewhere (render-blocking CSS); A/B the vital before shipping a change
  that costs something, e.g. a fidelity deviation (verify.md 5a).
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
  is the `web-animation-design` skill; this skill owns the loading/decode
  timing that determines whether there is a real image to animate - and
  whether a reveal animation is allowed to gate first paint at all
  (symptoms.md B7).
- `will-change`, transitions, tabular-nums, text-wrap live in the
  `make-interfaces-feel-better` skill.
- On React stacks, the DOM resource-hint APIs (`preload`, `preconnect`,
  `prefetchDNS`) are tabulated in the `vercel-react-best-practices` skill;
  this skill adds the framework-agnostic *why* (crossOrigin/CORS, exact-file
  matching, ordering/priority). The wider border with that skill: it owns
  steady-state React performance (re-render work, request waterfalls, bundle
  size); this skill owns what the user sees on a route's first paint,
  including streamed reveals and hydration-timing flashes.

## References

**Diagnose:**

- `references/symptoms.md` - the diagnostic decision tree (spine). START HERE.

**Fix:**

- `references/fonts.md` - self-hosted font loading: per-weight preload,
  crossOrigin, exact-file (`?url`) matching, metric-matched fallbacks,
  `font-display`, variable fonts, subsetting.
- `references/hosted-fonts.md` - fonts from a hosted CDN (Google Fonts):
  preconnect pair, `display=` param, `@import` chains, why gstatic woff2 can't
  be hand-preloaded, migrate-to-self-host; Adobe Fonts (Typekit): JS kit vs
  CSS embed, dashboard-only `font-display`, the three-preconnect set,
  self-host-not-licensed.
- `references/images.md` - eager/lazy, decode timing, priority/discovery, CLS
  reservation, responsive `srcset`/`<picture>`, Astro anti-patterns, GIF->video,
  LQIP, content-visibility.
- `references/resource-hints.md` - preload/preconnect ordering & priority,
  crossOrigin, exact-file matching, budget, 103 Early Hints, repeat-view cache
  headers + bfcache (with stack-specific subsections for
  Vite/Cloudflare/TanStack).

**Decide where:**

- `references/static-vs-ssr.md` - the fixed-at-build vs rendered-per-request vs
  streamed axis (per route; per hole under Cache Components): which verify tier
  applies, the streamed mode's commitment points (shell vs flush, fallback
  dimensions, boundary placement, status freeze, how to tell a route streams),
  per-route hybrids, embedded surfaces.
- `references/framework-automation.md` - what a framework's font/image layer
  automates <-> the hand-rolled equivalent, and the wrapping-code carve-out.
- `references/next.md` - where each generic fix lands on a Next route
  (next/font, metadata vs viewport, next/script, route CSS, next/image,
  `dynamic` with `ssr: false`) plus the Next-only PPR/streamed-route probes.
- `references/tanstack.md` - TanStack Router/Start: no font/image layer, so
  the hand-wired half applies in full; `head()`/`scripts()` routing and its
  dedupe/order footguns, pending-state (`pendingMs`/`pendingMinMs`) jank,
  what a deep link to an `ssr: false` route ships, `defaultPreload` as the
  next route's lever, Early Hints, CSS discovery by import style.

**Prove:**

- `references/verify.md` - how to prove a fix cold-cache: Tier 0 asserts on the
  static `dist/*.html` bytes; Tier 1 boots the route for SSR - with 3c scoping
  the same invariants to a streamed route's shell and probing the flush
  timeline; shared CLS probe, filmstrip/visual metrics for defects that move no
  vital (4e), measurement-tool gotchas, and a local Lighthouse A/B across the
  change (5a). The lens no other loading skill carries.

**Templates (read-as-reference, brand-agnostic - adapt per project):**

- `scripts/check-dist.mjs` - Tier-0 build-output guard: preload budget range,
  crossorigin, preload<->@font-face href match, non-blocking font-display on
  fetched faces, no stylesheet link, metric fallback presence, subset byte
  ceilings, scoped glyph coverage, immutable + public-font cache headers
  (block-scoped). Wire into CI after the build.
- `scripts/check-head.mjs` - Tier-1 booted-route guard: fetch a route (or pipe
  HTML in) and assert the same head invariants on rendered bytes.
- `scripts/check-stream.mjs` - Tier-1 streamed-route guard: read a booted
  route's body flush by flush, assert the head invariants on the shell only,
  print the flush timeline with React's boundary/swap markers, and flag a head
  split across flushes (verify.md 3c).
- `scripts/font-subset.config.mjs` - the single shared coverage module the subset
  generator and `check-dist.mjs` both import, so the shipped woff2 and the
  assertion can't drift.
- `scripts/lh-ab.mjs` - local Lighthouse A/B between two git refs (build ->
  serve `dist` -> median-of-N -> delta): prove a *costly* fix moves the targeted
  vital before shipping, no deploy. Corroboration / decision aid, not a gate
  (verify.md 5a).

**Maintenance (skill authors, not users of the skill):**

- `scripts/check-currency.mjs` (EXECUTE) + `scripts/currency-claims.json` - the
  registry of this skill's version-dated claims and how to re-check each one.
  Run at revision time (needs network, never a gate); a webstatus entry that
  gained a browser since its `verified` date means re-verify that claim in its
  file.

`evals/` holds the behaviour eval set (see writing-skills); it is intentionally
not routed from the workflow above.
