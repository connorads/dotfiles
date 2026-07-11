# Resource hints (preload / preconnect / prefetch)

> The React DOM hint APIs (`preload`, `preconnect`, `prefetchDNS`, `preloadModule`,
> `preinit`) are documented in
> `vercel-react-best-practices/rules/rendering-resource-hints.md`. This reference
> adds the *why* and the ordering/matching/budget gotchas that skill omits, NOT the
> API table.

**Prefetch boundary**: speculative loading of the *next* navigation is out of
this skill's first-load scope. If a project needs it, use the Speculation
Rules API, not legacy `<link rel=prefetch>`/`rel=prerender`.

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

So put font preloads **below** the stylesheet: a preloaded font gets Chrome's Highest
priority - the same as render-blocking CSS - and placing it first makes it contend for
bandwidth with the CSS the page needs to render (and the LCP image), worst on slow
links. web.dev puts font preloads below stylesheets for exactly this reason. Control
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
Worker to generate the response. Enable via dashboard Speed > Optimization > Content
Optimization > Early Hints (zone-level, not on `workers.dev`). It **works for
dynamic/uncacheable Worker responses** precisely because there is a render-latency gap.
Requires HTTP/2 or HTTP/3 and applies to navigation requests. Browser support is now
broad, but per-browser directive handling varies - some browsers act on the hints as
preconnect-only rather than full preloads - so treat 103 as an accelerator, never the
only delivery path for a hint. Eligibility:
`.html`/`.htm`/`.php` or no extension, 200/301/302 only; keep Link headers under ~8KB.
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
detail + responsive markup in images.md.

- <https://web.dev/articles/fetch-priority>

## Emitting hints on TanStack Start

Emit hints via the route `head()` option (`{ meta, links, styles, scripts }`) rendered
by `<HeadContent />` in `<head>` (root route for above-the-fold font preloads). Prefer
this over React 19 native `<link>` hoisting: Start's SSR-stream path is dedupe/stream-
aware, and mixing React 19 native metadata has caused double-rendered tags. The router
dedupes title/meta by deepest route (do not rely on it to dedupe repeated preloads).
`ReactDOM.preload()` works and dedupes by `href` (`as:image` also keys on
`imageSrcSet`+`imageSizes`) but must run in the SSR render context, and post-Suspense
preloads get appended to the stream tail (useless) - keep critical hints in the root
`head()`. Because the head is framework-rendered per request, verify by parsing the
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
  third-party analytics) still disqualify the page - use `pagehide` instead
  (Chrome is deprecating `unload`). Audit: DevTools > Application > Back/forward
  cache.
- <https://developers.cloudflare.com/workers/static-assets/headers/> ·
  <https://opennext.js.org/cloudflare> ·
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control> ·
  <https://web.dev/articles/bfcache>
