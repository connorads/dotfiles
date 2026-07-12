# Static prerender vs SSR: the axis that changes the diagnosis

Ask this **first**, before diagnosing a symptom: is the HTML *fixed at build*
(static prerender / SSG - Astro, an exported SPA shell, any `dist/*.html`) or
*rendered per request* (SSR from a Worker/edge or a Node server, and hydrated on
the client)? It is the axis that decides how you verify a fix and which
build-time gates are available. Everything else in this skill is shared; this
file owns only what the axis flips, and points at the reference that carries
the detail.

## What it changes

1. **NOT which jank classes can occur - look for reconciliation JS instead.**
   The state-mismatch family - a theme/active-state flip (`symptoms.md` B6,
   "FART") and its layout-moving twin (`symptoms.md` A4) - needs *client JS
   reconciling client-only state against the initial HTML*, and that JS ships
   on static builds too: a fully static page whose theme `<script>` reads
   localStorage flashes exactly like an SSR hydration flip. Do not rule B6/A4
   out because the build is static; rule them out only when there is no
   reconciling script or hydration step feeding the markup. Every symptom in
   this skill is possible on either side of the axis - what the axis governs is
   points 2 and 3 below. → `symptoms.md`.

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

## The axis is per-route, not per-site

Astro's `prerender` flag is per-route: one build can ship a prerendered
subset (Tier 0 - assert on those `dist/*.html` files directly) alongside SSR
routes rendered by the Worker (Tier 1 - boot and fetch), and the SSR route is
often the highest-traffic page. Classify each route you are diagnosing, not
the project; point `check-dist.mjs` at the prerendered subset only and use
`check-head.mjs` for the SSR routes (verify.md).

## Embedded / host-owned surfaces: a different game

In embedded contexts, which levers survive depends on *who owns the
document*, so split the two cases rather than treating "embedded" as one:

- **Host owns the whole document** (MCP/Apps-SDK widget resources, CSP-forced
  single-file surfaces): no author `<head>`, headers or caching - the
  hint/cache levers in this skill don't apply. First-load jank is
  widget-mount and async client-render: reserve the widget's height, ship a
  sized placeholder, render theme-neutral, and read the host's theme
  synchronously at mount (not in a post-mount effect - that is B6 in a
  widget).
- **Author owns the markup and head, host owns only transport** (Devvit
  web-views ship their own splash/game HTML inside the host iframe): inline
  critical CSS and an HTML skeleton in the mount node ARE available levers -
  only headers, caching and network hints are host-owned. Don't give up the
  in-document fixes just because the surface is embedded.

Either way, for heavy canvas/game engines draw an in-canvas loading scene
rather than leaving a blank element (the C1 app-shell pattern, in-surface).

## The edge/privacy corollary

Per-request assembly (SSR at an edge/Worker, locale or A/B branching) is also the
only place the edge/privacy lens bites - pre-auth anonymity constraints on what
you may preload or inline, and the 103-Early-Hints leak (`resource-hints.md`).
Full static prerender has no per-request logic, so that lens mostly collapses.
