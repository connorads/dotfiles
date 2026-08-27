# TanStack Router / Start: the first-load levers

Where each generic fix lands on this stack, and the footguns that only exist
here. Read it *after* the diagnosis, not instead of it: the symptom tree is
`symptoms.md`, the streamed-mode mechanics (shell vs flush, fallback
dimensions, boundary placement, status freeze, how to tell a route streams) are
generic and live in `static-vs-ssr.md`, the hint rules are in
`resource-hints.md`, and the proof is `verify.md` (3a boots a TanStack Start
route and asserts on its head; 3c scopes the same invariants to a streamed
shell).

**Start has no font layer and no image component, so the hand-wired half of
this skill applies as written** - it does own route CSS/JS asset discovery and
emission, optional CSS inlining and Early Hints collection (below). Zero
packages matching `font` or `image` across the 42-package monorepo, and no
fonts or images page in the Start React docs nav (checked Aug 2026). The docs'
own recommendations are third-party, and they cover a real share of the rows:
Fontsource packages ship `font-display: swap` and `unicode-range` subsets;
`@unpic/react` emits `srcset`/`sizes`, aspect-ratio box reservation, lazy by
default and a `priority` prop (eager + `fetchpriority="high"`). What neither
covers - per-weight preload wiring, metric-matched fallbacks, re-subsetting
fixed copy with a drift guard, the preload budget - stays `fonts.md`,
`images.md` and `resource-hints.md`'s (`framework-automation.md` for the
boundary).

Version shape: Start is at Release Candidate stage and its docs are served
under `/start/v0/`, while Router is at v1; packages are versioned
independently and releases are tagged by date, so "the TanStack version" is not
a single number (`@tanstack/react-router` 1.170.32, `@tanstack/react-start`
1.168.49 as of Aug 2026). Where a fix version is load-bearing it is named
below.

## Contents

- [What Start automates: the document head](#what-start-automates-the-document-head)
- [The pending-state machinery is the router's own jank source](#the-pending-state-machinery-is-the-routers-own-jank-source)
- [`ssr` per route: what a deep link ships](#ssr-per-route-what-a-deep-link-ships)
- [`defaultPreload`: the next route's first paint](#defaultpreload-the-next-routes-first-paint)
- [Early Hints: Start collects, your server entry sends](#early-hints-start-collects-your-server-entry-sends)
- [CSS discovery: the import style sets the timing](#css-discovery-the-import-style-sets-the-timing)
- [Scroll: hash scrolling is wired, restoration is not](#scroll-hash-scrolling-is-wired-restoration-is-not)
- [Sources](#sources)

## What Start automates: the document head

The `head()` route option returns `{ meta, links, styles, scripts }` - there
is no top-level `title` key; a title is a `meta` entry (`{ title: 'My App' }`),
whatever some docs examples show. `<HeadContent />` renders it; `<Scripts />`
carries the body scripts and the client entry (omit it and hydration breaks,
but head tags still appear). `head()` runs on the server - the router awaits
it with a context carrying `loaderData` and `params`, then renders the tags
into the shell HTML - so what it returns is scannable bytes, not a client-side
injection.

What to put in it (preload budget, `crossorigin`, exact-file matching,
ordering, `ReactDOM.preload()` versus React 19 native hoisting) is
`resource-hints.md`'s "Emitting hints on TanStack Start". Four footguns that
subsection does not carry:

- **Dedupe covers `title` and `meta` only**, deepest match winning. `links`,
  `styles` and head `scripts` are deduped on exact `JSON.stringify` equality
  within their own group. A parent and a child both preloading the same font
  emit two preloads whenever any attribute differs - straight into the preload
  budget.
- **Emission order is fixed, and manifest CSS lands after your links.**
  `HeadContent` emits meta and title (plus a `csp-nonce` meta when `ssr.nonce`
  is set), then manifest script preload links, then your `head().links`, then
  manifest-managed stylesheet links and the inline `<style>`, then your
  `head().styles`, then your `head().scripts`. So a hand-written `?url`
  stylesheet link precedes route CSS, and the manifest's script preloads
  precede every hint you wrote - which is what they contend with for
  bandwidth.
- **Server head projection stops at the first `ssr: false` match** (and at a
  non-success or not-found match; `'data-only'` does not truncate it). That
  route's own head tags reach the server HTML; its descendants' do not, and
  arrive only after the client load. A font preload declared on a child of an
  `ssr: false` route is absent from the shell, so the preload scanner never
  sees it.
- **`head().scripts` and the separate `scripts()` option are different
  channels, not aliases.** `head().scripts` renders in `<head>` via
  `HeadContent`; `scripts()` renders in `<body>` via `<Scripts />`, before the
  app entry point and therefore before hydration. That body slot is the
  pre-hydration one.

`ScriptOnce` is the stack's documented anti-flash primitive: it SSRs a
`<script>` that executes as the browser parses the HTML, before React
hydrates, removes itself from the DOM afterwards, and renders nothing on a
client navigation. That is the shape a theme/active-state flip needs here
(`symptoms.md` B6) - pair it with `suppressHydrationWarning` on `<html>` when
it mutates the DOM pre-hydration.

`<HeadContent assetCrossOrigin={...} />` takes one value or a
`{ script, stylesheet }` record and applies only to manifest-managed asset
links; it wins over a `crossOrigin` set by `transformAssets`.

## The pending-state machinery is the router's own jank source

Three route options, each falling back to a router-level default:
`pendingComponent` (shown once the route has been pending for `pendingMs`),
`pendingMs` (threshold, default 1000ms), `pendingMinMs` (minimum time the
pending component stays once shown, default 500ms). The stated purpose of the
minimum is to stop a jarring flash when data resolves just after the threshold
is met.

Five facts that change the diagnosis:

- **Without a pending component the timers are inert.** The pending offer
  returns early when no `pendingComponent` and no `defaultPendingComponent`
  exists, so `pendingMs`/`pendingMinMs` are dead config and no pending state is
  presented at all.
- **`beforeLoad` drives the pending component, not just `loader`.** A match
  carrying a `beforeLoad` is set to status `pending` and fires the pending
  offer, so a slow `beforeLoad` past `pendingMs` shows the fallback. The
  data-loading guide talks only about loaders (the `beforeLoad` API reference
  does document the threshold) - check `beforeLoad` before concluding the
  loader is the hold.
- **`pendingMinMs` is billed only once the fallback has actually rendered.**
  The minimum deadline is set inside the render acknowledgement, and the wait
  returns immediately when the fallback was never acknowledged or when its
  match has left the rendered set. A replacement load for the same match keeps
  the `pendingMs` timer; choosing a different match resets it.
- **A lazily-loaded `pendingComponent` is itself a first-load latency
  source.** Route chunk loading preloads the `component` *and* the
  `pendingComponent`, and the lane withholds its ready callback for a lazy
  route until that module has loaded - so the fallback cannot present until its
  own chunk has downloaded. Keep the pending component in the eager route
  module.
- **The hard-load hold is a fixed bug class, not current behaviour.** The
  symptom: on a hard refresh the pending element rendered immediately whatever
  the `pendingMs` threshold said, then charged the `pendingMinMs` penalty even
  though the threshold was never met - first load only. Reported as #1646,

  #2140 and #2722; the fix shipped as "pending component handling for initial
  load" in **v1.117.1** (Apr 2025), with #1646 closed months earlier by an
  unrelated change. No open issue in the repo mentions `pendingMinMs` (checked
  Aug 2026). The current code offers pending synchronously on a cold load only
  when there is no committed UI to retain, and still applies the `pendingMs`
  delay via a reveal timer. So on this symptom, check the installed version
  before reaching for a workaround.

One open first-load bug worth carrying: #7910 - during hydration of an
`ssr: false` route React can render a stale match still marked pending after
the router has cleared its `loadPromise`, and the throw is `undefined`, so the
error boundary has nothing useful to render (open as of Aug 2026).

## `ssr` per route: what a deep link ships

The route `ssr` option defaults to `true`; the global default is `defaultSsr`
on `createStart` in `src/start.ts` - a Start option, absent from the Router
`RouterOptions` reference. `true` runs `beforeLoad` and `loader` on the server,
ships their data, and server-renders the component. `'data-only'` runs both and
ships the data but does not server-render the component. `false` runs nothing
server-side and server-renders nothing.

What a hard navigation to such a route actually receives - the first-load
lever:

- **The server renders the `pendingComponent` of the first `ssr: false` or
  `'data-only'` match as the fallback**, or `defaultPendingComponent`, or - with
  neither configured - nothing, leaving a genuinely empty content area inside a
  server-rendered shell. So blank-then-paint on a deep link here is a missing
  pending component, not a streaming failure (`symptoms.md` C1).
- **The fallback is held for at least `pendingMinMs` during hydration even when
  the route defines no `beforeLoad` and no `loader`** - documented and
  deliberate. An `ssr: false` flag alone buys 500ms of skeleton by default.
  (The selective-SSR guide spells this `minPendingMs`; the option is
  `pendingMinMs`.)
- **Inheritance is one-way restrictive**: a child may only become more
  restrictive (`true` -> `'data-only'` -> `false`) and cannot re-enable SSR
  under an `ssr: false` parent. One flag high in the tree removes the server
  render for the whole subtree, head projection included (above).
- `ssr` may be a **function**. It runs on the server for the initial request
  only and is stripped from the client bundle, receiving post-validation
  `search`/`params` as a discriminated union (status `'error'` with `error`, or
  `'success'` with `value`).
- **The `<html>` shell stays server-rendered even with the root component's SSR
  off**: that is `shellComponent` on `createRootRoute`, which takes a single
  `children` prop and wraps the root component, error component or not-found
  component. It is always SSR'd, which is why `HeadContent` still ships in the
  shell.
- Selective SSR is **not** SPA mode: SPA mode disables server execution of
  `beforeLoad`/`loader` and server rendering wholesale, rather than per route.

## `defaultPreload`: the next route's first paint

A soft navigation counts as that route's first load (SKILL.md scope), so router
preloading is a first-paint lever - for the *next* route only.

- `defaultPreload` **defaults to `false`**: preloading is opt-in. `'intent'`
  uses hover and touch-start on a `<Link>`, `'viewport'` an Intersection
  Observer on a `<Link>`, `'render'` fires as soon as the `<Link>` renders.
- **It cannot help the first load of a hard-navigated URL**, because all three
  strategies key on a rendered `<Link>`. `router.preloadRoute()` is the
  imperative escape hatch.
- A preload buys the route chunk (both `component` and `pendingComponent`) and
  loader data - but the speculative lane is never promoted into the navigation:
  the navigation re-runs its own `beforeLoad` and reuses only settled or
  in-flight loader data. `'intent'` with the default 50ms
  `defaultPreloadDelay` is the default to reach for: pending preloads are
  cancelled when hover or focus ends or the link leaves the viewport, touch
  intent preloads immediately, and the per-link override is the `preloadDelay`
  prop.
- **Two freshness clocks, not one.** `preloadStaleTime` defaults to 30s
  (preloaded loader data is reusable without another loader call) while
  `staleTime` defaults to 0 (normally-loaded data is stale immediately and
  revalidates in the background). A preload that "did nothing" is often data
  re-fetched on the 0 clock. `preloadGcTime` (5 minutes) governs when an unused
  preload is pruned, not freshness. To hand freshness to an external cache such
  as React Query, set `preloadStaleTime` to 0 and let the router keep
  retention.
- **Route-level `preload: false` does not opt a route out of speculation**: a
  speculative lane still runs that route's `beforeLoad` and skips only its
  `loader`. `shouldReload` (`boolean`, or a function of the loader arguments
  returning one) is the per-route override on top of `staleTime`.

Hand-wired speculative loading and the prefetch budget are generic ->
`resource-hints.md`.

## Early Hints: Start collects, your server entry sends

Experimental and opt-in. Start collects manifest route assets and route
`head().links`, then calls the `onEarlyHints` callback you pass to
`handler.fetch(request, { ... })` in `src/server.ts`; **Start never sends the
103 itself**, because each platform exposes a different API for informational
responses. Documented routes: Node's `response.writeEarlyHints({ link })`,
srvx/Nitro reaching the underlying Node `res`, or `responseLinkHeader: true` to
append the collected links as a `Link` header so a CDN generates the 103 (with
a `responseLinkHeader.filter` callback to drop links that are not
cache-stable).

- **Two phases, different payloads.** `static` fires after route matching and
  before the router loads, carrying manifest assets for the matched routes;
  `dynamic` fires after `router.load()` unless the request redirects, carrying
  supported `head().links`. Static hints can precede `beforeLoad`, so they may
  be sent for a request that then redirects - sending `allLinks` in `dynamic`
  is the one combined, redirect-safe 103.
- **Only four relations are emitted**: `preload`, `modulepreload`,
  `preconnect`, `dns-prefetch`. A `rel: 'stylesheet'` head link is converted to
  `rel=preload; as=style`. `media`, `imageSrcSet` and `imageSizes` are
  deliberately not serialised, because HTML Early Hints processing does not
  apply them until the final document exists - so a responsive image preload
  does not survive the hop, the same limitation header preloads have generally
  (`resource-hints.md`).
- **Limits**: Early Hints are skipped in the Start dev server, browsers
  generally process only the first 103 per navigation, and the runtime or proxy
  in front of the app must support 103 at all.

The privacy caveat (a 103 replaying cached preload URLs ahead of an auth check)
and Cloudflare's harvest-and-replay mechanics are generic ->
`resource-hints.md`.

## CSS discovery: the import style sets the timing

Which stylesheet reaches the shell is decided by how the CSS is imported:

- **Side-effect imports (`import './global.css'`) and CSS modules** are
  discovered at build from the client manifest, so they get SSR stylesheet
  links, `static`-phase Early Hints, `transformAssets` rewriting and CSS
  inlining.
- **A `?url` import returned from `head().links`** is discovered when `head()`
  runs: `dynamic`-phase hints only, not rewritten by `transformAssets`, not
  inlined.
- **CSS imported by an async or lazy component** is in no static manifest for
  the initial route match, so it gets no initial SSR stylesheet link, no static
  Early Hint and no inlining. That is the flash-unstyled-then-snap case
  (`symptoms.md` B3); React 19's suspend-while-the-sheet-loads behaviour, which
  Start opts route stylesheets into by default, is the generic mitigation ->
  `static-vs-ssr.md`.
- **`server.build.inlineCss`** (experimental, production only) replaces
  manifest-managed stylesheet links with one inline `<style>` for the matched
  routes and preserves it through hydration. Costs: a larger HTML response,
  first-load CSS that cannot be cached independently of the HTML, inlined
  assets skipped by static Early Hints, and a strict CSP needing `ssr.nonce`
  set so `HeadContent` can nonce the rendered `<style>`. Per-request override:
  `inlineCss: ({ request }) => ...` on `createStartHandler`. For
  `transformAssets` to rewrite `url()`/`@import` inside the inlined CSS, the
  config must be the object form `inlineCss: { enabled: true, transformAssets:
  true }` - plain `inlineCss: true` leaves inlined URLs untouched.
- **Under a CDN**, `transformAssets` rewrites JS preload links,
  manifest-managed stylesheet links, the client entry script URL, and
  `url()`/`@import` inside inlined CSS (object form above) - and nothing else.
  Arbitrary `head().links` (including `?url` CSS) and assets imported directly
  in components are untouched, so those need the bundler's own control (Vite
  `experimental.renderBuiltUrl`, Rsbuild `output.assetPrefix`). Vite also needs
  `base: ''` - not `'./'`, which breaks the root-relative manifest paths the
  rewrite depends on - or client-navigation chunks resolve to the app server
  while initial-load assets come from the CDN. The docs say nothing at all
  about version skew: stale HTML pointing at hashed paths a redeploy removed is
  the app author's problem (static-vs-ssr.md's mode notes; the vendor-neutral
  name is version skew).

## Scroll: hash scrolling is wired, restoration is not

- Hash and top-of-page scrolling need no configuration; the setup runs
  unconditionally on the client, and survives `sessionStorage` being
  unavailable.
- **Scroll restoration - the position cache - is off by default.**
  `createRouter({ scrollRestoration: true })` is what flips
  `history.scrollRestoration` to `'manual'` and installs the capture-phase
  scroll listener, the pre-load snapshot and the `pagehide` persistence. It
  also accepts `({ location }) => boolean` to skip a given location. With it
  on, Start additionally SSRs a pre-hydration inline script that performs its
  own single anchor scroll before React boots.
- **The initial-load anchor scroll does not retry.** With restoration off, all
  positioning runs in one `router.subscribe('onRendered', ...)` handler, and
  the anchor branch is a single
  `document.getElementById(hash)?.scrollIntoView(...)` (with restoration on,
  the pre-hydration script's attempt is equally single-shot). If the target
  has not rendered by then - still pending, still streaming, or behind a lazy
  chunk - a deep link to that anchor silently does not scroll. The fix is
  getting the anchor's subtree into the shell (an `ssr: false` route cannot),
  not retuning scroll options.
- A hash suppresses the scroll-to-top branch. The scroll-into-view behaviour
  is controlled by the `hashScrollIntoView` prop on `<Link>`/navigate and the
  router option `defaultHashScrollIntoView` (boolean or `ScrollIntoViewOptions`).
- `scrollRestorationBehavior` (`'smooth' | 'instant' | 'auto'`) matches
  browser behaviour, `scrollToTopSelectors` adds nested scrollable elements
  alongside the window, and `getScrollRestorationKey` defaults to the history
  entry's `__TSR_key`.
- **The `<ScrollRestoration />` component is deprecated** in favour of the
  router option and force-enables restoration regardless of that option; so
  does `useElementScrollRestoration`. A stray one turns the feature on
  invisibly.

## Sources

- <https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management> ·
  <https://tanstack.com/router/latest/docs/framework/react/api/router/RouteOptionsType> ·
  <https://tanstack.com/router/latest/docs/framework/react/api/router/RouterOptionsType>
- <https://tanstack.com/router/latest/docs/framework/react/guide/data-loading> ·
  <https://tanstack.com/router/latest/docs/framework/react/guide/preloading> ·
  <https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration>
- <https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr> ·
  <https://tanstack.com/start/latest/docs/framework/react/guide/early-hints> ·
  <https://tanstack.com/start/latest/docs/framework/react/guide/css-styling> ·
  <https://tanstack.com/start/latest/docs/framework/react/guide/cdn-asset-urls>
- <https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js> ·
  <https://tanstack.com/start/latest/docs/framework/react/start-vs-nextjs>
- <https://github.com/TanStack/router/blob/main/packages/router-core/src/load-client.ts> ·
  <https://github.com/TanStack/router/blob/main/packages/router-core/src/scroll-restoration.ts> ·
  <https://github.com/TanStack/router/releases/tag/v1.117.1> ·
  <https://github.com/TanStack/router/issues/7910>
