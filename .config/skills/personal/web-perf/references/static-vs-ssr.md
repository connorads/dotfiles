# Static prerender vs SSR: the axis that changes the diagnosis

Ask this **first**, before diagnosing a symptom: is the HTML *fixed at build*
(static prerender / SSG - Astro, an exported SPA shell, any `dist/*.html`) or
*rendered per request* (SSR from a Worker/edge or a Node server, and hydrated on
the client)? It is the only axis that changes which defects are possible and how
you verify a fix. Everything else in this skill is shared; this file owns only
what the axis flips, and points at the reference that carries the detail.

## What it changes

1. **Which jank classes can occur.** The hydration-mismatch family - a
   theme/active-state flip (`symptoms.md` B6) and its layout-moving twin
   (`symptoms.md` A4, "FART") - needs a server-rendered default that a client
   hydration step can disagree with. Under full static prerender with no
   hydration (or no client state feeding the markup) **neither can happen** -
   rule them out immediately instead of chasing a cookie/blocking-script fix that
   has nothing to fix. Every other symptom (font swap, image pop-in, unreserved
   boxes, render-blocking CSS) is stack-independent. → `symptoms.md`.

2. **How you verify.** Static prerender means `dist/*.html` IS the shipped bytes,
   so you assert on the files directly with a Node script - no server, no browser
   (`verify.md` Tier 0). SSR renders the head per request, so you boot the route
   and assert on the rendered bytes (`verify.md` Tier 1). The cold-cache-by-eye
   pass and the CLS probe are shared. → `verify.md`.

3. **What static prerender unlocks: build-time gates on a shared config.**
   Because the output is fixed, first-load invariants become a cheap CI step over
   `dist` (preload budget, crossorigin, exact-file match, subset coverage). The
   pattern that makes the coverage check trustworthy: the subset generator and
   the checker `import` **one shared module** of glyph ranges, so the shipped
   woff2 and the assertion cannot drift. → `verify.md` Tier 0 +
   `scripts/font-subset.config.mjs`.

## The edge/privacy corollary

Per-request assembly (SSR at an edge/Worker, locale or A/B branching) is also the
only place the edge/privacy lens bites - pre-auth anonymity constraints on what
you may preload or inline, and the 103-Early-Hints leak (`resource-hints.md`).
Full static prerender has no per-request logic, so that lens mostly collapses.
