# Static prerender vs SSR vs streamed: the axis that changes the diagnosis

Ask this **first**, before diagnosing a symptom: how does the HTML reach the
browser? Three answers, not two.

- **Fixed at build** - static prerender / SSG (Astro, an exported SPA shell, any
  `dist/*.html`). The shipped bytes sit on disk.
- **Rendered per request** - SSR from a Worker/edge or a Node server, hydrated on
  the client. The response is a finished document by the time it starts.
- **Streamed** - rendered per request, but the response arrives as a shell plus
  later flushes: React streaming SSR, Next App Router with `<Suspense>` /
  `loading.tsx`, Cache Components/PPR (a static shell with streamed holes),
  TanStack Start's stream handler, Astro's on-demand rendering, SvelteKit
  promises returned from a server `load`. The shipped bytes are a timeline, not
  a document.

The answer decides how you verify a fix, which build-time gates are available,
and - in the streamed case - which bytes are still changeable when. Everything
else in this skill is shared; this file owns only what the axis flips, and
points at the reference that carries the detail.

## Contents

- [What it changes](#what-it-changes)
- [The axis is per-route, not per-site](#the-axis-is-per-route-not-per-site)
- [Cached HTML outliving its assets: version skew](#cached-html-outliving-its-assets-version-skew)
- [The streamed mode: what is fixed at which flush](#the-streamed-mode-what-is-fixed-at-which-flush)
  - [Fallback dimensions are the CLS control](#fallback-dimensions-are-the-cls-control)
  - [Boundary placement is a TTFB / skeleton / blank trade-off](#boundary-placement-is-a-ttfb--skeleton--blank-trade-off)
  - [Status and headers freeze at the first flush](#status-and-headers-freeze-at-the-first-flush)
  - [How to tell a route streams](#how-to-tell-a-route-streams)
- [Embedded / host-owned surfaces: a different game](#embedded--host-owned-surfaces-a-different-game)
- [The edge/privacy corollary](#the-edgeprivacy-corollary)

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

2. **How you verify - one tier per mode.** Static prerender means `dist/*.html`
   IS the shipped bytes, so you assert on the files directly with a Node script -
   no server, no browser (`verify.md` Tier 0). SSR renders the head per request,
   so you boot the route and assert on the rendered bytes (`verify.md` Tier 1).
   A streamed route is Tier 1 as well, but assert on the **shell** - the first
   flush, which is where the head ships - and reach for the flush-timeline probe
   (`verify.md` 3c) when the question is *when* a byte arrives rather than
   whether it exists. The cold-cache-by-eye pass and the CLS probe are shared.
   → `verify.md`.

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

**With Cache Components it is finer than per-route: it is per hole.** Next 16
folds PPR into `cacheComponents: true`, a top-level `next.config` flag that
subsumes the removed `experimental.ppr` and `experimental_ppr` segment option;
it is opt-in and off by default, and it requires the Node.js runtime. A route
under it prerenders a **static shell** at build - `use cache` results,
`<Suspense>` fallback UI, and predictable values such as module imports or pure
computation - and streams the runtime holes at request time, so `cookies()` in
one subtree does not force the whole route dynamic the way the pre-16 model
did. Classify the *hole* you are diagnosing, not just the route: the shell is
cacheable bytes servable from a CDN, each hole is a later flush. Where the
dynamic params are unknown at build, the shell degrades to the App Shell - the
same static shell with the param-specific parts left behind their fallbacks -
and ISR fills in concrete versions after the first visit.

- <https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents> ·
  <https://nextjs.org/docs/app/getting-started/caching>

## Cached HTML outliving its assets: version skew

Any mode that serves HTML from a cache - ISR, a CDN-cached SSR response, a
service-worker shell, or the browser's own HTTP cache - can hand a client a
document whose hashed asset URLs a later deploy deleted. The first load is then
blank or partial: the entry or a route chunk fails and nothing renders past it.
Vite names version skew as the first cause of "Failed to fetch dynamically
imported module" (the others being a flaky network and ad-blockers).

- **Shipped browsers cannot retry the import.** Chrome and Firefox record the
  failure in the module map, so a second `import()` of the same URL returns the
  cached rejection with no request at all; Safari re-fetches. The spec has
  since been changed to require a re-fetch after a failed module load
  (whatwg/html#10327, July 2026), with engine implementations trailing as of
  Aug 2026. Vite emits a `vite:preloadError` event carrying the original error
  in `event.payload`, and `event.preventDefault()` suppresses the rethrow
  only - it makes nothing loadable. The
  `Cannot read properties of undefined (reading 'default')` TypeError shows up
  around the same failures as a broken-lazy-import signature - treat it as a
  possible skew symptom, not a React bug.
- **On Cloudflare Pages the failure presents as a parse error, not a 404.** A
  request for a deleted asset falls through to the SPA fallback: `200` with
  `content-type: text/html`, which the browser then tries to parse as a module
  ("is not a valid JavaScript MIME type" / "Failed to load module script"). Fix:
  `public/assets/404.html` - Pages resolves the closest `404.html` in the
  request path, so `/assets/<missing>.js` gets an honest 404 while a client
  route still gets the shell. A **top-level** `public/404.html` instead
  disables the SPA fallback for every legitimate client route. Assert the
  triple: missing asset -> 404, a fake SPA route -> 200 `text/html`, current
  entry JS -> 200 `application/javascript`. Rule out plain MIME
  misconfiguration and a deploy-propagation race (correct new filename, shell
  served, cured by a cache purge) before blaming skew.
- **Recovery is a full navigation, guarded.** Register the handler as an
  **inline classic** `<script>`: it must have executed before the module
  runtime loads, a module script is subject to the same failed fetch it exists
  to recover from, and an external one is a second request the stale deploy can
  equally fail to serve. Reload once - guard on `sessionStorage` keyed by the
  error message plus a timestamp (suppress a repeat within a few minutes),
  which survives the reload but dies with the tab, or a permanently missing
  chunk becomes an infinite refresh loop. The reload only helps if the HTML is
  not itself cached: serve it `no-cache`, or it re-serves the same stale
  document and the handler fires again. A router that loads its own route
  chunks may never dispatch `vite:preloadError` - TanStack's
  `lazyRouteComponent` ships its own guarded one-shot reload instead
  (tanstack.md).
- **The durable fix is retention, not recovery.** A reload still loses
  in-flight state and the chunk is still gone; keep the previous deployment's
  assets alive at release-scoped immutable URLs, so an old tab keeps loading
  the files its HTML names. To size the problem first, grep an error tracker
  for "Failed to fetch dynamically imported module", "Failed to load module
  script", "is not a valid JavaScript MIME type" and the `reading 'default'`
  TypeError.
- <https://vite.dev/guide/build> · <https://vite.dev/guide/troubleshooting> ·
  <https://github.com/whatwg/html/issues/6768> ·
  <https://github.com/whatwg/html/pull/10327> ·
  <https://github.com/vitejs/vite/issues/18042> ·
  <https://ard.ninja/blog/2026-05-16-react-lazy-vite-cloudflare-pages-stale-chunk-errors/>

## The streamed mode: what is fixed at which flush

A streamed response has two commitment points, not one.

- **The shell** is everything outside a Suspense boundary: layouts, navigation,
  and the boundaries' own fallback UI. React calls this the shell and it
  "determines the earliest loading state the user may see". It flushes first,
  and it carries the head - Next puts the `<link>` and `<script>` tags in the
  very first HTML chunk, so the browser discovers CSS, JS and fonts while the
  server is still rendering the rest.
- **Each later flush** is one boundary's completed HTML plus an inline script
  that swaps the fallback DOM node for it. The swap runs without waiting for the
  page bundle or for hydration.

Three consequences for this skill's levers:

- **Only shell bytes get early discovery.** The speculative (preload-scanner)
  parser is fed the same input byte stream as the main parser, so it reads ahead
  within bytes that have *arrived* and cannot look forward in time. A hint in a
  later flush is discovered when that chunk lands, not before - which is why
  post-Suspense preloads appended to the stream tail buy nothing
  (resource-hints.md). Markup React streams into a later chunk is still server
  markup and so is still scannable once flushed; markup a client component
  renders after hydration never is.
- **The hydration machinery sits at the tail.** React emits `bootstrapScripts`
  after `</html>`, and TanStack's stream transform injects dehydrated router
  state immediately before `</body>`. What you put at the head of the stream is
  what decides first paint.
- **A late-discovered stylesheet is handled by delaying the reveal, not by
  arriving earlier.** React 19 suspends the component rendering a
  `<link rel="stylesheet">` while the sheet loads and inserts it into `<head>`
  on the client before revealing the boundary that depends on it - no unstyled
  flash, but no earlier byte either. This needs the `precedence` prop and is
  silently inert without it (or with `itemProp`, `onLoad` or `onError`
  present). TanStack Start opts route stylesheets in by default. So a head
  assertion on the shell is the right default; read the whole stream when the
  claim is specifically about a late-discovered sheet.
- <https://react.dev/reference/react-dom/server/renderToReadableStream> ·
  <https://nextjs.org/docs/app/guides/streaming> ·
  <https://html.spec.whatwg.org/multipage/parsing.html#speculative-html-parsing> ·
  <https://react.dev/reference/react-dom/components/link>

### Fallback dimensions are the CLS control

The reveal is a DOM replacement in flow, so **the fallback's box is the layout
reservation**. Next states the mechanism plainly: when a Suspense fallback is
replaced by the resolved content the browser reflows, and if the two are
different sizes the surrounding layout shifts. Two mitigations, both
shell-side: design the skeleton to match the dimensions of the content it
stands in for, or reserve the slot with a fixed or `min-height` container
around the boundary. The same geometry governs LCP: an LCP element inside a
boundary cannot paint until the swap script runs, and `next/image`'s preload
controls when the image is *fetched*, not when it *paints*. → the symptom leaf
is `symptoms.md` A5, whose reservation rule is A2's applied to the fallback's
box.

Do not over-claim swap timing: the reveal is throttle-batched, not instant.
`$RC` marks the boundary queued (comment data `$~`) and pushes it onto a global
batch; the flush (`$RV`) runs in a `requestAnimationFrame` while no reveal has
yet stamped its time, and thereafter on a `setTimeout` targeting the last
reveal's time + 300ms (`FALLBACK_THROTTLE_MS`) - except when the call lands
between 2000ms and 2300ms, where the reveal is scheduled at 2300ms
(`TARGET_VANITY_METRIC`, derived from the 2.5s LCP "good" threshold). One
flush replaces every batched boundary in a single task, so several swaps can
share one layout-shift entry, and reveal timestamps cluster at ~300ms after
the previous reveal or at ~2300ms - the fingerprint for matching a
layout-shift `startTime` to a boundary swap (`symptoms.md` A5). `$RR` delays
it further: a boundary carrying `precedence` stylesheets sets `$~` itself,
then waits for those sheets before queueing the reveal. Verified against
react-dom 19.2.8 (Aug 2026).

- <https://nextjs.org/docs/app/guides/streaming>

### Boundary placement is a TTFB / skeleton / blank trade-off

Where you draw the boundary is a first-paint decision, so it is in scope here.
It trades three things against each other:

- **No boundary**: the server waits for the slowest query before sending
  anything, so TTFB equals that query and the user sees blank. Under Cache
  Components, uncached or runtime access with no enclosing `<Suspense>` is a
  build-time blocking-route error - the framework forcing the choice so every
  route keeps producing a static shell.
- **One boundary high in the tree** (`loading.tsx` at the route, which wraps
  `page.js`, `not-found.js` and nested layouts in a Suspense boundary): TTFB
  drops to the time it takes to render layouts and fallbacks, but the whole page
  is skeleton. The prerenderer walks up from the dynamic access to the *nearest*
  boundary and stops, so a high `loading.tsx` is found first and granular
  streaming is lost.
- **Boundaries close to each dynamic access**: the shell carries real content and
  only the dynamic holes are skeleton. This is Next's stated preference, and the
  default to reach for.

Two constraints on going finer. A boundary with enough content activates *even
when nothing in it suspends* - sending HTML takes time - so an unnecessary
boundary can introduce a skeleton of its own; don't add one you don't need. And
`loading.tsx` does not cover its own segment's layout: a layout reading
`cookies()`, `headers()` or uncached data gets no fallback from it - without
Cache Components, navigation blocks until that layout renders; under Cache
Components the unwrapped access is a build-time error instead.

The shell-maximising rule underneath all three: awaiting `params`,
`searchParams`, `cookies()`, `headers()` or a fetch at the top of a layout or
page makes everything below that point dynamic and unprerenderable. Pass the
promise down and resolve it inside the boundary instead.

- <https://nextjs.org/docs/app/guides/streaming> ·
  <https://nextjs.org/docs/app/api-reference/file-conventions/loading> ·
  <https://react.dev/reference/react/Suspense>

### Status and headers freeze at the first flush

Streaming starts when a Suspense fallback renders or a component suspends under
one, and the server must commit to `200 OK` to start sending. After that chunk
leaves, the status code and headers are fixed:

- `notFound()` mid-stream cannot become a 404. Next injects
  `<meta name="robots" content="noindex">` into the streamed HTML instead; some
  crawlers label the result a soft 404, and the explicit noindex is what keeps
  it out of the index.
- `redirect()` mid-stream becomes a client-side redirect, not an HTTP redirect
  header.
- An error thrown after the first flush is caught by the nearest `error.js`
  boundary and rendered in place of the failed component, leaving the rest of
  the page intact - and the 200 stands.

For a real HTTP status, run the check before any Suspense boundary - Next's own
example awaits `params` and a cheap slug-existence check ahead of the boundary,
then calls `notFound()` - or move it earlier still into `proxy.ts` or a
`next.config.js` redirect. The rule is not Next-specific: SvelteKit forbids
`setHeaders` or a thrown redirect inside a streamed promise, and Astro exposes
response-header features at page level only, because component code runs after
the headers are sent. On the React APIs, `onShellError` is the last point at
which no bytes have been emitted, and it is a `renderToPipeableStream` (Node)
callback - `renderToReadableStream` has no `onShellReady`/`onAllReady`, it
resolves its promise at shell completion and exposes `stream.allReady` for the
buffer-everything path (crawlers, static generation) at the cost of all
progressive delivery.

- <https://nextjs.org/docs/app/guides/streaming> ·
  <https://react.dev/reference/react-dom/server/renderToPipeableStream> ·
  <https://svelte.dev/docs/kit/load> ·
  <https://docs.astro.build/en/guides/on-demand-rendering/>

### How to tell a route streams

**Default: grep the shell for React's boundary markers.** React encodes Suspense
boundaries as HTML comments - `<!--$?-->` followed by
`<template id="B:0"></template>` is a *pending* boundary, `<!--$-->` … `<!--/$-->`
delimit a completed one, `<!--$~-->` is a boundary queued for reveal (its
pending comment's data rewritten in place), and `<!--$!-->` marks one that
fell back to client rendering. The later flush arrives as `<div hidden id="S:0">…</div>` plus an
inline swap call - `$RC("B:0","S:0")`, or `$RR(…)` when the boundary carries
`precedence` stylesheets, `$RS(…)` for a segment. Pending markers in the first
bytes mean the route streams and name the holes.

Headers are the weaker tell: over HTTP/1.1 a streamed document carries
`Transfer-Encoding: chunked` and no `Content-Length`; over HTTP/2 there is no
chunked encoding, so absence of `Content-Length` is all you get.

**Escape hatch, when the question is timing rather than presence**: read the body
with a Node `fetch` + `body.getReader()` loop under `Accept-Encoding: identity`
and print an offset per chunk (`verify.md` 3c). `curl -N` flushes on newlines,
so a newline-free stream looks stalled. In DevTools, an early TTFB with a long
Content Download phase on the document request says the same thing with less
precision.

**Differential check**: request the same URL with a bot user agent (for example
`Twitterbot/1.0`). Next detects crawlers by UA and renders the whole page before
revealing it, and the tell is the *markers*, not the chunk count (chunk count is
transport framing): zero pending `<!--$?-->` boundaries and zero swap calls,
against the same route's normal-request tally. That same behaviour is a trap
worth knowing twice over: a page whose shell depends on build-only inputs can
render for a person and fail for a crawler, and a probe run with a bot-like UA
measures a different code path than your users get.

**Where the knob lives differs by stack**, so check the right one before
concluding a route cannot stream. In TanStack Start it is an entry-point choice
(`defaultStreamHandler` vs `defaultRenderHandler`, both exported from
`@tanstack/react-start/server`), not a route option - the route's `ssr` option
(`true` / `'data-only'` / `false`) controls *whether* a route is
server-rendered, an orthogonal axis; plain TanStack Router SSR without Start
streams via `renderRouterToStream` plus the Vite plugin's `enableStreaming`. In
SvelteKit it is a promise returned unawaited from a **server** `load`
(universal `load` promises are not streamed). In Astro it is on by default for
on-demand rendering, at component granularity, and a component's own `await`s
hold its chunk.

**What defeats streaming even when the framework emits it**: nginx and similar
reverse proxies buffer by default (`X-Accel-Buffering: no`), CDNs may buffer the
whole response, AWS Lambda needs response streaming enabled explicitly, gzip and
brotli can hold chunks before flushing, and static export does not support
streaming at all. SvelteKit names the same failure for Lambda and Firebase, and
Astro's Node adapter ships `experimentalDisableStreaming` (`@astrojs/node`
9.3.0+; `@astrojs/react` has an unrelated option of the same name) for hosts
that only cache non-streamed HTML. If the tell says "one chunk" on a route you
believe streams, suspect the transport before the code.

**Safari**: Next's docs give a 1024-byte threshold below which a streamed
response paints all at once. Treat that as a rule of thumb, not a spec - the
WebKit bug it cites describes an unresolved "contentful pixels" first-paint
heuristic with no byte figure (bug 252413, still open as of Aug 2026), and
padding bytes alone do not trigger the early paint. Real pages clear it; only
minimal demos and tiny route handlers hit it.

- <https://nextjs.org/docs/app/guides/streaming> ·
  <https://github.com/TanStack/router/blob/main/packages/react-start-server/src/index.tsx> ·
  <https://svelte.dev/docs/kit/load> ·
  <https://docs.astro.build/en/guides/integrations-guide/node/> ·
  <https://bugs.webkit.org/show_bug.cgi?id=252413>

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
