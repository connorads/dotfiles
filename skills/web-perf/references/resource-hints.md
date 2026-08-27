# Resource hints (preload / preconnect / prefetch)

> The React DOM hint APIs (`preload`, `preconnect`, `prefetchDNS`, `preloadModule`,
> `preinit`, `preinitModule`) are documented in
> `vercel-react-best-practices/rules/rendering-resource-hints.md`. This reference
> adds the *why*, the ordering/matching/budget gotchas that skill omits, and
> React 19's own emission behaviour (below), NOT the API table.

**Prefetch boundary**: a soft navigation counts as the next route's first
load, so speculative loading is in scope as that route's first-paint lever.
Hand-wired, use the Speculation Rules API, not legacy
`<link rel=prefetch>`/`rel=prerender`; router-level prefetch (Next `<Link>`,
TanStack `defaultPreload`) is that framework's automation - defer to it and
inspect the wrapping code (framework-automation.md).

## Contents

- [What this adds over the vercel skill](#what-this-adds-over-the-vercel-skill)
- [Ordering: it controls priority, not discovery](#ordering-it-controls-priority-not-discovery)
- [Preload budget](#preload-budget)
- [preconnect vs dns-prefetch](#preconnect-vs-dns-prefetch)
- [modulepreload (Vite already does it)](#modulepreload-vite-already-does-it)
- [103 Early Hints on Cloudflare](#103-early-hints-on-cloudflare)
- [fetchpriority x preload](#fetchpriority-x-preload)
- [React 19: how the hint calls emit](#react-19-how-the-hint-calls-emit)
- [Emitting hints on TanStack Start](#emitting-hints-on-tanstack-start)
- [Cache-control that shapes repeat-view first paint](#cache-control-that-shapes-repeat-view-first-paint)

## What this adds over the vercel skill

- **crossOrigin on font preloads** - see fonts.md; a missing `crossorigin` causes a
  credentials-mode mismatch, so the preload record is discarded and the font is
  fetched twice.
- **Exact-file matching** - the preload href must equal the file the consuming rule
  (`@font-face src`, `<img>` src) actually requests, byte for byte including the
  fingerprint. With Vite that is what `?url` guarantees. A near-miss = two fetches and
  a wasted preload.

## Ordering: it controls priority, not discovery

The preload scanner is a secondary parser that scans raw markup ahead of the main
parser and discovers **all** declarative preloads regardless of position relative to
the stylesheet. A stylesheet is render-blocking, not markup-parser-blocking, so it does
NOT hide a later `<link rel=preload>`. **Order does not change discovery.**

So put font preloads **below** the stylesheet: a preloaded font is fetched at high
priority and dispatched immediately - competing with render-blocking CSS - and
placing it first makes it contend for bandwidth with the CSS the page needs to
render (and the LCP image), worst on slow links. web.dev puts font preloads below stylesheets for exactly this reason. Control
priority/budget, not discovery order.

- <https://web.dev/articles/preload-scanner> ·
  <https://web.dev/learn/performance/optimize-web-fonts>

## Preload budget

Preload is zero-sum priority; over-preloading dilutes and causes bandwidth contention
(worst on slow networks). Chrome-team budget: **at most ~2 images + 2-3 essential
fonts per page**; `fetchpriority=high` on at most 1-2 LCP images. Preload only
**late-discovered** critical resources (fonts in CSS, `@import`, CSS-background/LCP
images not in the initial HTML) - not things already in the HTML the browser finds
anyway. An unused preload = a Chrome console warning ~3s after load, strictly worse
than none.

- <https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/optimize-preload-priority.md> ·
  <https://web.dev/articles/preload-critical-assets>

## preconnect vs dns-prefetch

- `preconnect` = full DNS + TCP + TLS (~3 RTT, saves ~100-500ms), expensive; the
  browser closes an unused socket after ~10s -> only for a few critical, soon-used
  cross-origins.
- `dns-prefetch` = DNS only (~20-120ms), cheap; the right hint for lower-confidence
  origins and a preconnect fallback. Keep the two in SEPARATE `<link>` tags (combining
  triggers a Safari bug).
- **Load-bearing when self-hosted:** self-hosting fonts (fontsource) means there is
  no third-party origin to hint - the browser is already connected for HTML/CSS - so
  preconnect/dns-prefetch are pure waste unless an analytics/image CDN remains a
  distinct early origin. With **hosted Google Fonts** the opposite holds: the
  `fonts.googleapis.com` (no crossorigin) + `fonts.gstatic.com` (crossorigin)
  preconnect pair IS load-bearing - see hosted-fonts.md.
- <https://web.dev/articles/preconnect-and-dns-prefetch>

## modulepreload (Vite already does it)

A standard Vite HTML build auto-generates `<link rel="modulepreload">` for entry chunks
and their direct static imports, and preloads async-chunk shared deps in parallel - no
config (`build.modulePreload` defaults to `{ polyfill: true }`). Hand-adding
modulepreload for the SSR->hydration entry path is usually redundant; only needed for
custom/backend non-HTML entries (where you also `import 'vite/modulepreload-polyfill'`).

- <https://vite.dev/guide/features> · <https://vite.dev/config/build-options>

## 103 Early Hints on Cloudflare

The Worker does NOT send 103 itself. Attach a standard
`Link: </file.woff2>; rel=preload; as=font` header to your normal 200/301/302 HTML
response; Cloudflare's Early Hints feature harvests + caches those Link headers (keyed
by URI, query ignored) and replays a cached `103 Early Hints` without waiting for the
Worker to generate the response. Enable via dashboard Speed > Settings > Content
Optimization tab > Early Hints (zone-level, not on `workers.dev`). It **works for
dynamic/uncacheable Worker responses** precisely because there is a render-latency gap.
Requires HTTP/2 or HTTP/3 and applies to navigation requests. Browser support is now
broad, but per-browser directive handling varies - some browsers act on the hints as
preconnect-only rather than full preloads (Safari notably) - so treat 103 as an
accelerator, never the only delivery path for a hint. Measurement caveat: since
Chrome 133 `responseStart` includes the 103, so enabling Early Hints lowers
*reported* TTFB without changing real server time - judge a fix by LCP/FCP, not
TTFB. Eligibility:
`.html`/`.htm`/`.php` or no extension, 200/301/302 only, and Link headers carrying
`rel=preload`/`rel=preconnect` only. Cloudflare documents no Early-Hints-specific size
cap; the zone budget is 128KB of response headers total (checked Aug 2026). Keep the hint
list short because over-hinting contends for bandwidth, not to hit a byte cap.
Responsive `imagesrcset` preloads do NOT work here (or in HTTP-header preload).

- **Privacy caveat (the edge lens):** an unauthenticated visitor can receive a 103 with
  cached Link headers ahead of a 403. Under a pre-gate anonymity constraint, do not leak
  gated asset URLs via Early Hints - scope them to anonymous/pre-gate assets only.
- <https://developers.cloudflare.com/cache/advanced-configuration/early-hints/> ·
  <https://developers.cloudflare.com/workers/examples/103-early-hints/>

## fetchpriority x preload

Images fetch at Low priority by default; preload aids DISCOVERY only, at default
priority; `fetchpriority` sets priority, not discovery - so preloaded images need
`fetchpriority="high"`. Reserve it for the true LCP element, never decorative art. Full
detail + responsive markup in images.md. It is two-directional: pair `high` on
the LCP element with `low` on a non-critical resource that contends for the same
bandwidth (an offscreen image, a secondary font, a late non-blocking script) -
the concrete competing/carousel-image lever is in images.md. Fonts are the
asymmetric case: already High by default, so `fetchpriority="high"` on a font
preload is a no-op (fonts.md).

- <https://web.dev/articles/fetch-priority>

## React 19: how the hint calls emit

On a React 19 stack the hints above are imperative calls made during render
(`import { preload } from 'react-dom'`), so the ordering, budget and exact-file
rules still apply - you just control them through call sites and props. The API
table is the `vercel-react-best-practices` skill's; this is the emission
behaviour it omits. Verified against react-dom 19.2.8 (Aug 2026); items marked
*undocumented* are observed implementation behaviour, not contract.

**Where the bytes land is decided by the phase, not by the call site.**

- **Server, during render** - buffered and flushed into the shell `<head>`
  wherever the calling component sits in the tree (a `preload` called from a
  component inside `<body>` lands in `<head>` in the first chunk). Emission
  order is React's priority ranking *across buckets*, call order within one -
  "links/scripts are prioritized by their utility to early loading, not call
  order". The buckets, in flush order: charset, dns-prefetch + preconnect
  (one bucket), viewport, font preloads, high-priority image preloads,
  stylesheets by precedence, import map, bootstrap scripts, scripts, then the
  bulk-preload bucket (style/script/plain-image/modulepreload preloads
  together, by call order), the blocking-render instruction, and finally
  every plain rendered `<link>`/`<meta>`/`<title>` (hoisted tags come last).
- **Client, at call time** - the call inserts a node into `document.head`
  synchronously, with no render involved, which is why an event handler is the
  documented place to warm the resources a soft navigation will need. It is a
  silent no-op until a DOM dispatcher exists: with `react-dom` imported but not
  `react-dom/client`, the identical calls insert nothing.
- The same hint reads differently in each phase: server HTML carries camelCase
  attributes (`imageSrcSet`, `fetchPriority`), client-inserted nodes the
  lowercase DOM ones - so assert attribute names case-insensitively.

**Two calls that emit nothing where you expected bytes.** On the server, "[the
API] only has an effect if you call it while rendering a component or in an
async context originating from rendering a component. Any other calls will be
ignored" - a module-scope `preload` before render emits nothing at all. A call
made after the shell has flushed does emit, but into that later chunk
(discovery timing: static-vs-ssr.md), and its shape changes:
`preinit(href, { as: 'style' })` before the flush emits
`<link rel="stylesheet" data-precedence>` in the head; after the flush it emits
only `<link rel="preload" as="style">`, with the sheet insertion deferred to
the client.

**Dedupe keys - calls dedupe, elements do not.** `preload` keys on `href` -
except `as: 'image'` with `imageSrcSet` present, which ignores `href` entirely
and keys on `imageSrcSet` + `imageSizes` (19.2.8 source);
`preinit`/`preloadModule`/`preinitModule` key on `href`, and
`preconnect`/`prefetchDNS` on the server. A rendered `<link rel="preload">`
element gets none of that: three identical elements emit three tags, and a call
plus a matching element emits two links (the call also adds a font's
`crossorigin`, the element does not). So pick the call *or* the tag per
resource, never both. Hoisted `<script src async>` and `<style href precedence>`
do dedupe, by `src`/`href`.

**Hoisting, and the props that switch it off.** `<link>`, `<meta>` and `<title>`
hoist to `<head>` from anywhere in the tree; `<script>` hoists only with `src`
*and* `async={true}` ("The `async` prop must be true to allow scripts to be
safely moved"); `<style>` only with `href` *and* `precedence`, and React "will
drop all extraneous props" once `precedence` is set. `itemProp` disables
hoisting on all of them, and `onLoad`/`onError` disable it on `<link>` and
`<script>` - with either present you are managing loading yourself. A hoisted
element lands in tree order among the head's children, in the last flush
bucket - one more reason to use the call for anything priority-sensitive.
`precedence` is a first-seen-order group label, not a ranked scale: rendering
`low` before `reset` puts `low` first and an arbitrary string is accepted, so
the docs' reset/low/medium/high is a naming convention. The stylesheet
consequences - a late-discovered sheet, and `<link rel="stylesheet">` being
inert without `precedence` - are static-vs-ssr.md's.

**`preinit` applies, `preload` only fetches.** "Scripts that you `preinit` are
executed when they finish downloading", and stylesheets "are inserted into the
document, which causes them to go into effect right away" - so a shell-phase
`preinit` of a stylesheet ships a render-blocking sheet, which is the point for
critical CSS and a regression for anything else. Use `preload` when you want the
bytes warm but not applied or executed; `preloadModule`/`preinitModule` are the
same split for ESM. `preinit` takes only `as: 'script' | 'style'`; `precedence`
is documented as required for a stylesheet, and silently defaults to `default`
when omitted (19.2.8).

**The responsive-image double download.** Passing `imageSrcSet` makes React omit
`href` from the emitted link entirely and key the dedupe on
`imageSrcSet + imageSizes` (above), so the browser resolves the candidate from
`imagesrcset`/`imagesizes` alone. Any difference from the rendered `<img>`'s
`srcSet`/`sizes` - whitespace or descriptor order included - selects a different
URL, so the preload goes unused and the image is fetched twice. This is the
responsive arm of exact-file matching above; react.dev never states the
requirement (only that the options "help the browser fetch the correctly sized
image"), so it falls out of HTML candidate selection plus React's dedupe key.
**Default: do not hand-write preloads for a plain rendered `<img>` on React 19
SSR.** React already emits one preload per rendered `<img>`, copying `srcSet`
-> `imageSrcSet` and `sizes` -> `imageSizes` verbatim, so its own version
cannot mismatch (undocumented) - and the budget becomes a suppression job:
`loading="lazy"`, `fetchPriority="low"` or a `data:` URI suppresses the
auto-preload, and only the first ten image preloads (plus any
`fetchPriority="high"`) reach the high-priority head bucket. Two carve-outs
where a hand preload is still yours to write: an `<img>` inside `<picture>` or
`<noscript>` gets no auto-preload (exactly the art-directed markup images.md
prescribes), and CSS-background / JS-inserted LCP images (images.md) never had
one.

**`onHeaders` moves hints into a `Link` header.** Passing it to a streaming
render diverts preconnect, dns-prefetch, font preloads and plain-`href` image
preloads out of `<head>` into an HTTP `Link` header - the feed for the 103
Early Hints path above. Responsive (`imageSrcSet`) preloads never divert, so
the responsive rule above is unaffected; style and script preloads and
`preinit` stylesheets stay as head tags too. Undocumented on react.dev, and the
payload shape differs by entry point: `renderToReadableStream`/`prerender` hand
the callback a `Headers` instance (read `headers.get('link')`);
`renderToPipeableStream` hands a plain `{ Link }` object. `maxHeadersLength`
defaults to 2000; overflow falls back to head tags. Use it only when the host
consumes `Link` headers.

- <https://react.dev/reference/react-dom/preload> ·
  <https://react.dev/reference/react-dom/preinit> ·
  <https://react.dev/blog/2024/12/05/react-19> ·
  <https://react.dev/reference/react-dom/components/link> ·
  <https://react.dev/reference/react-dom/components/script>

## Emitting hints on TanStack Start

Emit hints via the route `head()` option (`{ meta, links, styles, scripts }`) rendered
by `<HeadContent />` in `<head>` (root route for above-the-fold font preloads). Prefer
this over React 19 native `<link>` hoisting: Start's SSR-stream path is dedupe/stream-
aware, and mixing React 19 native metadata has caused double-rendered tags. The router
dedupes title/meta by deepest route (do not rely on it to dedupe repeated preloads).
`ReactDOM.preload()` works, under the call-site, dedupe and phase rules in the
React 19 section above - keep critical hints in the root `head()` so they land
in the shell. Because the head is framework-rendered per request, verify by parsing the
booted route's bytes, not the source (verify.md).

- <https://tanstack.com/router/latest/docs/guide/document-head-management> ·
  <https://react.dev/reference/react-dom/preload>

## Cache-control that shapes repeat-view first paint

Resource hints fix the *cold* first paint; cache headers decide the *repeat*
one. Two rules, plus a host default that quietly breaks both:

- **Fingerprinted assets -> `immutable`.** A content-hash in the filename
  (`app.9f3a12c.js`, `/_astro/*`) means the bytes can never change under that
  name, so serve `Cache-Control: public, max-age=31536000, immutable`. `immutable`
  additionally suppresses the revalidation request a plain reload would still
  send. Repeat views then paint from disk with zero network for those assets.
- **Non-hashed assets (favicons, `og.png`, manifest) -> a short explicit TTL**
  (e.g. `max-age=86400`) - they can change under a stable name, so you want
  revalidation, but not on *every* view.
- **Fonts at stable `public/` paths need their own explicit long-TTL rule.**
  A font served from `public/fonts/inter-400.woff2` has no content hash, so it
  can never be immutable-by-hash - and a `_headers` file whose only
  Cache-Control rule covers the hashed dir (`/_astro/*`) leaves every font
  revalidating on repeat views. Add an explicit rule for the font path (e.g.
  `/fonts/*` with a long `max-age`; version the *path* when the file changes),
  or move fonts into the hashed pipeline.
- **The host default often revalidates everything.** Cloudflare Workers static
  assets default to `Cache-Control: public, max-age=0, must-revalidate` (+ an
  ETag), so without an explicit rule every repeat view sends a conditional
  request for every asset and waits for the 304 - fine for freshness, needless
  latency for hashed files. Set the rules above in a `_headers` file (which
  overrides the default for asset responses, though **not** for Worker-generated
  responses - SSR/`run_worker_first` must set headers in code). Check your
  platform's default before assuming assets are cached.
- **OpenNext on Workers: `next.config` `headers()` does NOT cover static
  assets.** Assets are served by Workers static-assets without the Worker
  running in front of them, so config-level headers never apply and the
  `max-age=0, must-revalidate` default stands - including for the hashed
  `/_next/static/*` files. Fix: a `public/_headers` file with
  `/_next/static/*` -> `public, max-age=31536000, immutable` (alternative:
  `run_worker_first` routes assets through the Worker so code-set headers
  apply, at the cost of a Worker invocation per asset).
- **Plugin-managed Worker deploys own the asset headers.** With
  `@cloudflare/vite-plugin`, alchemy, nitro presets and similar, the deploy
  layer emits/controls asset-header config - find which layer owns it
  (`_headers`, plugin option, or generated wrangler config) and override
  there rather than adding a second, ignored mechanism.
- **bfcache decides whether back/forward is instant.** A back/forward
  navigation served from bfcache repaints instantly with zero first-load jank;
  a page blocked from bfcache replays the full cold-load sequence on every
  back/forward. `Cache-Control: no-store` on the HTML blocks bfcache in
  Firefox/Safari; Chrome (since the 2025 CCNS rollout) does bfcache `no-store`
  pages under safeguards (evicted on cookie/auth changes, shorter lifetime).
  `no-cache` / short `max-age` never blocked it. `unload` handlers (often
  third-party analytics) disqualify the page on Firefox desktop, and on Chrome
  desktop wherever `unload` still fires - use `pagehide` instead. Chrome's
  deprecation rollout turns the `unload` permission off by default, so the
  listener never registers and cannot block bfcache (80% of Chrome page
  loads at Chrome 152, 100% planned at Chrome 154; as of Aug 2026). A site that
  opts back in with `Permissions-Policy: unload=self` keeps the old blocking
  behaviour. Chrome and Safari on mobile always cached unload pages. Audit:
  DevTools > Application > Back/forward cache.
- <https://developers.cloudflare.com/workers/static-assets/headers/> ·
  <https://opennext.js.org/cloudflare> ·
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control> ·
  <https://web.dev/articles/bfcache>
