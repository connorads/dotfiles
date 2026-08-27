# Next.js: the first-load levers

Once the diagnosis says the route is Next, this file names **where** each fix
lands - which API, which file convention - and the footguns inside Next's own
layer. It is an index of levers, not a diagnostic tree.

- **Symptom -> cause** stays `symptoms.md`. That spine is stack-agnostic; read
  it first.
- **Streaming mechanics** are `static-vs-ssr.md`: shell vs later flush,
  fallback dimensions as the CLS control, boundary placement, the status/header
  freeze, how to tell any route streams, Cache Components at per-hole
  granularity. This file adds only the Next-only probes, in the last section.
- **What Next automates vs what you hand-wire** is `framework-automation.md`'s
  table, including the `adjustFontFallback`-per-family and
  unused-weight-array footguns. This file owns the automated layer's own knobs
  and failure modes.

Version context, as of Aug 2026: Next 16 is the current major (16.3.x, Active
LTS), Turbopack is its default bundler from `v16.0.0`, and Next 15 is
Maintenance LTS to 21 Oct 2026. Re-check with `pnpm info next version` before
trusting a version-gated claim below.

## Contents

- [Fonts: next/font](#fonts-nextfont)
- [Head and metadata: where a `<link>` actually lands](#head-and-metadata-where-a-link-actually-lands)
- [Scripts: next/script strategies as C1 levers](#scripts-nextscript-strategies-as-c1-levers)
- [CSS delivery](#css-delivery)
- [Images: next/image](#images-nextimage)
- [Client-only rendering: `ssr: false`](#client-only-rendering-ssr-false)
- [Identifying a PPR / streamed route in practice](#identifying-a-ppr--streamed-route-in-practice)
- [Sources](#sources)

## Fonts: next/font

**Defaults, read off the option validators**: `display: 'swap'`,
`preload: true`; `fallback` has no default. `adjustFontFallback` is on by
default in both loaders - `true` for google, and for local the loader applies
an Arial-derived default downstream (`'Times New Roman'` or `false` to
change it).

**`subsets` gates preloading, not shipped bytes.** Next builds the Google
`css2` URL with no `subset=` parameter, so Google returns every subset's
`@font-face` and Next self-hosts all of them (`Inter:wght@100..900` comes back
as 7 faces: cyrillic-ext, cyrillic, greek-ext, greek, vietnamese, latin-ext,
latin). What a visitor downloads is gated by each face's `unicode-range`, by
the browser. `subsets` decides only which files are marked preloadable. So a
narrow `subsets` list is not a bytes win, and a wide one is not a bytes
regression - it is a preload-budget decision (resource-hints.md).

**Next does no subsetting of its own.** `next/font/google` serves Google's
already-subset files; `next/font/local` emits the file you supply
byte-for-byte. Re-subsetting to your *fixed copy*, with a coverage guard, stays
hand-rolled (fonts.md).

**`preload: true` with no `subsets` on a Google font is a build error, not a
warning.** The validator calls `nextFontError`, which throws. Fix by naming the
subsets or setting `preload: false`. Where a family has no preloadable subsets
at all, Next silently forces `preload = false` instead of erroring - so a
family can lose its preload with no output.

**Audit tell: the emitted filename.** Preloadable files carry `.p.` in the
name (`[hash].p.[ext]`); a size-adjust metric fallback adds `-s`, giving
`[hash]-s.p.[ext]`. `preload: false` just omits `.p`. Lean on those substrings
rather than the directory prefix - the path is `static/media/...`, or
`static/immutable/media/...` where an adapter's immutable static assets are on
(16.3+). Turbopack filters on the same `.p.` / `-s` substrings and writes the
same `next-font-manifest.json` shape, so this is bundler-independent - a
webpack-vs-Turbopack switch does not change preload behaviour.

**Preload scope is per-module, and the module is where you call the font
function.** The manifest maps module request -> font files, so a font called in
`page.tsx` preloads on that page only, in a layout on every route beneath it,
and in the root layout everywhere. Where a route uses fonts but none are
preloadable - and nothing else on the page has been preloaded yet - Next
preconnects to the `assetPrefix` origin (or `/`) instead; like the font
preloads, that preconnect may surface as a `Link:` header rather than an HTML
tag, so its absence from the head is not its absence.

**Font preloads usually are not in the HTML.** Next does not render a `<link>`;
it calls `ReactDOM.preload(href, { as: 'font', type })`, and React promotes
`as: 'font'` preloads to an HTTP `Link:` response header whenever the header
budget allows (Next wires `onHeaders` with `maxHeadersLength:
reactMaxHeadersLength`, default 6000 characters, settable top-level in
`next.config`). Next's own e2e suite asserts the HTML contains zero of them.
Consequence for auditing: **grepping the HTML head for `as="font"` produces a
false negative** - read the response headers too. Live check on nextjs.org (Aug
2026) returns the Geist preloads as `link:` headers with `.p.` / `-s.p.`
filenames and no font `<link>` in the body.

**Hand-rolled font preloads: use `ReactDOM.preload`, not JSX.** A rendered
`<link rel="preload" as="font">` fails three ways at once:

1. React passes hoistable-link props through verbatim, so it gets no automatic
   `crossorigin` - omit it and the preload cannot be reused by the CSS font
   fetch, i.e. a double download (the mechanism is fonts.md's crossOrigin
   rule). React hard-codes `crossorigin=""` for `as: 'font'` on the
   `ReactDOM.preload` path regardless of what the caller passes, which is why
   next/font's preloads always match.
2. It is not deduped against next/font's. `ReactDOM.preload` dedupes calls by
   href (resource-hints.md), but a rendered `<link>` never registers as a
   React resource - and a hand-written href can never match next/font's
   content-hashed URL (plus `?dpl=` when `deploymentId` is set) anyway.
3. It flushes in `hoistableChunks`, dead last in the head - after the route
   stylesheets and after every React-managed preload (the flush-order rule is
   resource-hints.md's React 19 section). `ReactDOM.preload` from a Client
   Component lands in the early font-preload slot instead.

**The `@font-face` ships inside the route's CSS chunk.** `next-font-loader`
returns CSS that css-loader treats as a CSS module, so the faces travel in the
route's `<link rel="stylesheet">` (or its inline `<style>` under
`experimental.inlineCss`) rather than as their own head tag. Font preloads
flush before stylesheets, so the font fetch starts before the CSS that
references it arrives.

The generated module holds: the hashed-family `@font-face`; a synthetic
`@font-face { font-family: '<Family> Fallback'; src: local("Arial") ... }` with
`ascent-override`/`descent-override`/`line-gap-override`/`size-adjust` when
`adjustFontFallback` is on; a `.className` rule; and a `.variable` rule. Two
consequences that look like bugs:

- **`variable: '--x'` emits only the custom property.** The `.variable` class
  sets no `font-family`, so applying it alone changes nothing until your CSS
  consumes `var(--x)` - a silent render-in-fallback (symptoms.md, the gate
  before B).
- **`.className` carries `font-weight` only for a single non-range value.**
  With `weight: ['400','700']` or a variable `'100 900'` range, the weight
  declaration is dropped (a single `style` survives) and you set
  `font-weight` yourself.

Other levers worth knowing:

- **Weight array vs variable font is a file-count decision.** Google's URL
  builder emits one variant per weight x style combination, each a separate
  file; a variable font is one file per subset covering the range. Trimming an
  over-wide array is framework-automation.md's rule.
- **`axes`** (google only) defaults to weight alone to hold file size down;
  adding an axis changes the requested file, and `axes` on a non-variable font
  is a build error.
- **`declarations`** (local only) is applied *before* Next's own descriptors, so
  a `font-family` there suppresses the generated hashed family name. Next always
  appends `src`, `font-display` and weight/style after yours.
- **`display`** for google is baked into the Google Fonts request URL and comes
  back inside Google's `@font-face`; for local, Next writes `font-display`
  itself. Invalid values are a build error either way. The strategy choice is
  fonts.md's.
- **Every call of a font function is a separate hosted instance.** The same
  family called in two files is emitted twice. Keep one font-definitions module
  and re-export.
- **A failed Google download degrades in dev and throws in production.** In dev
  the loader returns a fallback-only `@font-face` and logs
  `Failed to download ... Using fallback font instead` to the terminal - if dev
  shows permanent fallback text, check the terminal before the CSS.
- **next/font cannot be used in `pages/_document.js`** - the loader throws for
  that path.
- <https://nextjs.org/docs/app/api-reference/components/font> ·
  <https://nextjs.org/docs/messages/google-fonts-missing-subsets> ·
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/reactMaxHeadersLength>

## Head and metadata: where a `<link>` actually lands

App Router generates the head from a static `metadata` object or
`generateMetadata` (Server Components only). `<meta charset="utf-8">` and
`<meta name="viewport" content="width=device-width, initial-scale=1">` are
emitted even with no metadata at all. Segments evaluate root -> nearest to
`page.js`, and Metadata objects merge **shallowly** with the deeper segment
replacing a duplicate key.

**Viewport is a separate export** (`viewport` object / `generateViewport`,
Next 14+, Server Components only, and the two cannot coexist in one segment).
It owns `themeColor`, `colorScheme`, `width`, `initialScale`, `viewportFit`
and friends. Under Cache Components, viewport cannot stream - it affects
initial page-load UI, so request-time viewport blocks the page (documented
escape hatches: `use cache`, a document-level Suspense boundary, or
`instant = false`) - which makes `generateViewport` a first-load blocking
lever that `generateMetadata` is not. Metadata by contrast streams, and
streamed metadata tags are appended to the `<body>`, not the head. Prerendered
pages never stream metadata; html-limited bots (`htmlLimitedBots`) get blocking
metadata instead - the crawler-vs-user divergence is static-vs-ssr.md's bot
differential.

**The Metadata API deliberately does not emit hints.** Unsupported:
`<link rel="preload">`, `preconnect`, `dns-prefetch`, `stylesheet`, `<style>`,
`<script>`, `<base>`, `<noscript>`, `<meta http-equiv>`. Two documented
substitutes: `ReactDOM.preload` / `preconnect` / `prefetchDNS` from a Client
Component (still server-rendered on first load), or render the tag in the
layout or page.

**React 19 hoists plain `<link>` and `<meta>` into the head from anywhere in
the tree, Server Components included** - but hoisted tags flush *last* in the
head, after the route stylesheets and every React-managed preload (the
hoisting conditions and flush order are resource-hints.md's React 19 section).
So a hand-written preload in a layout lands after the stylesheets it was meant
to beat; reach for `ReactDOM.preload` when ordering matters.

**`next.config`'s `crossOrigin` has no default.** It shapes stylesheet links
and script preloads; it does not touch font preloads, which React fixes to
anonymous.

- <https://nextjs.org/docs/app/api-reference/functions/generate-metadata> ·
  <https://nextjs.org/docs/app/api-reference/functions/generate-viewport> ·
  <https://react.dev/reference/react-dom/components/link>

## Scripts: next/script strategies as C1 levers

**The genuine parser-blocking lever is a raw `<script src>` without `async` in
a layout**, because React renders it in place rather than hoisting it. No
next/script strategy is parser-blocking; if you are chasing a C1 blank screen
(symptoms.md C1), audit raw script tags first.

`strategy` defaults to `afterInteractive`. The four:

- **`beforeInteractive`** emits no native `<script src>` in App Router. It
  renders an inline script pushing `[src, props]` onto `self.__next_s`, plus a
  `ReactDOM.preload(src, { as: 'script' })`; Next's client runtime creates the
  real element. **It is hydration-blocking and serialised**: `appBootstrap`
  runs `loadScriptsInSequence(self.__next_s, hydrate)`, chaining each script's
  load promise and calling `hydrate()` only in the final `.then()`. The docs'
  line that its execution "does not block page hydration" is contradicted by
  that code path. It must live in a root layout, runs once per document load,
  and is not re-run on client navigation (including a root-param change such as
  `/en` -> `/fi`).
- **`afterInteractive`** loads from a `useEffect`:
  `document.createElement('script')` appended to `document.body`, therefore
  async and never parser-blocking. App Router additionally emits
  `ReactDOM.preload(src, { as: 'script' })` during SSR, so the bytes start from
  the head preload - which also means it spends preload budget
  (resource-hints.md).
- **`lazyOnload`** waits for window `load` (or `readyState === 'complete'`)
  then `requestIdleCallback`. No SSR preload is emitted, so it costs nothing
  before first paint. Note window `load` waits for every image - the
  load-event amplifier (symptoms.md B7).
- **`worker`** requires `experimental.nextScriptWorkers`, is Pages-Router-only,
  and is unsupported under Turbopack - so it is unusable on a default Next 16
  App Router project. Do not recommend it as a main-thread fix there.

`onLoad`/`onReady`/`onError` work only in Client Components, and
`onLoad`/`onError` cannot be combined with `beforeInteractive` (use `onReady`).

- <https://nextjs.org/docs/app/api-reference/components/script>

## CSS delivery

App Router ships route CSS as `<link rel="stylesheet" href precedence
crossOrigin nonce>` preceded by a `ReactDOM.preload(href, { as: 'style' })`.
**It does not inline critical CSS by default**, so the C1 "inline critical CSS"
fix is a config decision here, not a hand-edit.

**Every production stylesheet shares one precedence group.** The `precedence`
value is the constant string `'next'` in production and `'next_' + path` in
development (distinct per file, deliberately, so HMR preserves order). Within
one group React orders by discovery - which is why **CSS order can differ
between `next dev` and `next build`, and the build is the one that counts**.
Verify ordering against a production build before believing a B3-class
unstyled-flash or wrong-cascade report is fixed.

**`experimental.inlineCss: true`** swaps every generated `<link>` for a
`<style precedence href>` in the head. Its documented limits are the trade:
global only (no per-page opt-in), styles duplicated on initial load (once in
the `<style>`, once in the RSC payload), navigations to prerendered pages fall
back to `<link>`, and it is production-only.

**In Chromium, the first-paint gate on an App Router full document is React's
blocking-render instruction, not the stylesheet link**: React writes
`<link rel="expect" href="#_R_" blocking="render">` after the font preloads
and stylesheets, so a full document blocks display until the whole shell has
downloaded without delaying those fetches. `rel="expect"` is Chromium-only
(Baseline limited - Firefox and Safari ignore it and paint on their normal
rules), so name it as the C1-class mechanism only where the report is
Chrome-shaped.

**Chunking**: `experimental.cssChunking` defaults to `true` on both bundlers
(merge where import-order dependencies allow). The correctness escape hatch is
webpack-only - `false` and `'strict'` do not exist on Turbopack, the Next 16
default; `'graph'` is Turbopack-only, cost-based and tunable via `requestCost`
and `weightDistribution`. The option is flagged experimental and not
recommended for production, so treat a chunking change as a diagnosis step
rather than a fix to ship.

**Turbopack CSS-ordering divergences to expect when a route's cascade looks
wrong:**

- Turbopack always follows JS import order for otherwise-unordered CSS modules;
  webpack sometimes ignores inferred order (for example when it judges a JS
  file side-effect-free). Documented workaround: force the relationship with an
  `@import` between the modules.
- Lightning CSS rounds to 5 decimal digits against webpack's 10, which moves
  computed `line-height` / `letter-spacing` slightly - a real source of "it
  shifted by a pixel after migrating".
- Open ordering bugs exist rather than being resolved: as of Aug 2026,
  vercel/next.js issues 94895 (cascade order broken in production builds), 83941
  (dev vs build prioritisation differ), 94980 and 64921 are all open, and PR
  89615 was closed unmerged. Before treating a Turbopack cascade defect as your
  bug, search the tracker.

Two documented App Router caveats that outlive the bundler choice: stylesheets
are not removed on client navigation (React's Suspense-integrated stylesheet
support keeps them, which can conflict across routes), and dev-vs-production
ordering differs as above.

- <https://nextjs.org/docs/app/getting-started/css> ·
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/cssChunking> ·
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/inlineCss> ·
  <https://nextjs.org/docs/app/api-reference/turbopack#css-module-ordering> ·
  <https://github.com/vercel/next.js/issues?q=is%3Aissue+is%3Aopen+turbopack+css+order>

## Images: next/image

**`priority` is deprecated in favour of `preload` from Next 16.** It still
functions (`preload: preload || priority`) and there is no standalone
deprecation warning, so old code keeps working; warnings fire for `priority` +
`loading="lazy"`, `preload` + `loading="lazy"`, and `preload` + `priority`
together. Any snippet or review comment reaching for `priority` is stale on 16.

**And `preload` is not the default hero fix.** The docs steer to
`loading="eager"` or `fetchPriority="high"` for most cases, reserving `preload`
for a single unambiguous LCP candidate. `preload` emits a `<link rel="preload"
as="image">` in the head and nothing else - it does **not** set
`fetchpriority`, which is a pure pass-through prop on the `<img>`. Documented
cases not to use it: several candidate LCP images across viewports, or when
`loading`/`fetchPriority` are already doing the job. A light/dark dual-image
theme switch specifically cannot use `preload` or `loading="eager"` (both
images would load) - `fetchPriority="high"` is the lever there.

**`preload`/`priority` disable lazy loading by omitting the attribute
entirely**: with no explicit `loading`, no `loading` attribute is emitted, so
the browser's eager default applies. Emitted defaults otherwise:
`loading="lazy"`, `decoding="async"`, inline `style: { color: 'transparent' }`,
`quality` 75.

**`sizes` on a `fill` image: the defect is over-fetching, not a broken
srcset.** Omitting it yields a full w-descriptor srcset across all eight
`deviceSizes` (to 3840w) plus a `sizes="100vw"` fallback that Next supplies -
so a small element downloads a viewport-width image. With `sizes` present,
widths come from `deviceSizes` + `imageSizes` filtered by the smallest `NNvw`
token; with no `sizes` and a numeric `width`, you get exactly two x-descriptors
(1x, 2x - 3x is deliberately omitted). `imageSizes` entries are used only for
images that pass `sizes`, and a `srcSet` prop passed to `<Image>` is not
forwarded.

**`fill` mechanics that throw rather than degrade**: the parent needs
`position: relative|fixed|absolute`; passing `width` or `height` alongside
`fill` throws, as does a `style.position` other than absolute or a
`style.width` other than 100%.

**`placeholder="blur"` is CSS on the `<img>`, not a data URL in `src`.** It
emits `backgroundImage` (the `blurDataURL` wrapped in an SVG with
`feGaussianBlur`), `backgroundSize` from `objectFit` (default `cover`),
`backgroundPosition` and `backgroundRepeat: no-repeat`, all dropped once load
completes. Being inline style, it paints without JS - which is why it does not
fail the cache-hit-before-hydration lens the way an `onLoad` fade does.
`blurDataURL` is auto-generated only for a static import of a non-animated
jpg/png/webp - a static `.avif` import with no `blurDataURL` silently degrades
to `placeholder="empty"` (the docs' avif listing is stale against
`get-img-props.ts`). A remote `src` needs it supplied by hand, at 10px or less
(a large one hurts more than it helps). `getImageProps()` cannot be used with
`placeholder` at all, because the placeholder would never be removed.

**The dev LCP warning names `loading="eager"` on Next 16**, and it is narrowly
gated: a `PerformanceObserver` on `largest-contentful-paint` that fires only
when the LCP element is a next/image with `loading === 'lazy'` **and**
`placeholder === 'empty'`. So a blurred hero, or an already-eager hero, never
warns however slow it is - absence of the warning is not evidence.

**`unoptimized` removes responsive sizing entirely** (no `srcset`, no `sizes`;
only a `?dpl=` query on local paths). It is force-enabled, overriding the prop,
for a `data:`/`blob:` src, for `images.unoptimized` in config, and for a `.svg`
src on the default loader without `dangerouslyAllowSVG`. A custom `loader` that
ignores `width` gets a dev warning telling you to implement it or use
`unoptimized`.

**Self-hosting cost of the default loader**: URLs are
`/_next/image?url=...&w=...&q=...`, `formats` defaults to `['image/webp']`,
`qualities` defaults to `[75]` and must be widened explicitly on 16 (out-of-list
values coerce with a dev warning; a direct hit with a disallowed quality gets
400). AVIF encodes roughly 50% slower for roughly 20% smaller output, so the
first request for an image is the slow one and later ones come from the disk
cache (`<distDir>/cache/images`, `minimumCacheTTL` 14400s). **A proxy or CDN in
front of Next must forward the `Accept` header** or format negotiation breaks,
and the loader deliberately does not forward headers when fetching `src`, so an
authenticated source image needs `unoptimized`.

**Documented browser bugs still worth checking on a real device**: Safari
15-16.3 shows a grey border while lazy-loading (fix: eager above the fold, or
the `clip-path: inset(0.6px)` `@supports` hack); Firefox 67+ shows a white
background while loading (fix: enable AVIF in `formats`, or use a placeholder);
pre-Safari-15 does not derive aspect ratio from attributes, so `width/height:
auto` styling can shift there.

For a hero inside a streamed route, the boundary swap gates the paint whatever
you preload - static-vs-ssr.md's rule.

- <https://nextjs.org/docs/app/api-reference/components/image> ·
  <https://nextjs.org/docs/app/guides/streaming#lcp-largest-contentful-paint>

## Client-only rendering: `ssr: false`

**A deep link into an `ssr: false` subtree is a guaranteed blank-then-paint
(symptoms.md C1), by construction.** On the server the component is wrapped in
`BailoutToCSR` (rendered `<BailoutToCSR reason="next/dynamic">`), which throws
a `BailoutToCSRError` carrying `digest = 'BAILOUT_TO_CLIENT_SIDE_RENDERING'`;
the nearest Suspense boundary catches it and emits its fallback. No HTML for
that subtree is ever produced, so real content cannot appear until the client
bundle boots, hydrates, and the dynamic chunk's `import()` resolves - two
sequential steps after the HTML lands.

**The `loading` option is the only lever that puts markup there.** App Router
computes `hasSuspenseBoundary = !ssr || !!loading`, so `ssr: false` always gets
a Suspense wrapper with `fallback = Loading ? <Loading .../> : null`. With no
`loading`, the server HTML contains nothing at that position; with one, the
skeleton is in the HTML. Size that skeleton to the content it replaces - the
reservation rule is symptoms.md A2, applied to the fallback's box.

**It can also FOUC on arrival.** `<PreloadChunks>` - the CSS preload that
exists "to avoid flash of unstyled content" - is rendered only on the
`ssr: true` path, so an `ssr: false` subtree discovers its stylesheet when the
chunk executes.

**Pages Router differs in a way that changes the HTML.** `noSSR` returns
`<Loading ... pastDelay={false} />` on the server, and the default `loading`
implementation returns `null` when `!pastDelay` - so the default emits nothing,
while a custom `loading` that ignores `pastDelay` does render into the HTML.

**`ssr: false` is Client-Component-only** and errors in a Server Component;
move it into a Client Component. Two adjacent code-splitting facts that shape
first load: a Server Component dynamically importing a Client Component gets no
automatic code splitting, and dynamically importing a Server Component
lazy-loads only its Client Component children, not the Server Component itself.

- <https://nextjs.org/docs/app/guides/lazy-loading>

## Identifying a PPR / streamed route in practice

How to tell whether *any* route streams - React's boundary markers in the
shell, the chunked-transfer tell, the bot-UA differential, what defeats
streaming in transport - is `static-vs-ssr.md`, and so is the fact that Cache
Components folds PPR in and needs the Node.js runtime. Four Next-only probes on
top:

**Response headers.** `x-nextjs-postponed: 1` means this render actually
postponed. The same header set to `2` appears on segment-prefetch responses as
a plain feature flag - the segment payload itself carries whether its data is
dynamic - so do not read `2` as "postponed". `x-nextjs-prerender: 1` marks the
response static, which the client router uses to apply the `static` staleTime.
Siblings on the same responses: `x-nextjs-stale-time`,
`x-nextjs-rewritten-path`, `x-nextjs-rewritten-query`, `x-nextjs-request-id`,
`x-nextjs-html-request-id`.

`x-nextjs-postponed` is set inside the app-page runtime, so whether it survives
to the browser depends on the hosting adapter and any CDN in front. Confirm it
appears on a live deployment before reading its absence as "no PPR".

**Build output, read with its caveat.** The legend is `○ (Static)`,
`● (SSG)`, `◐ (Partial Prerender)` - prerendered HTML with dynamic
server-streamed content - and `ƒ (Dynamic)`. The symbol under-reports: on the
Edge runtime it is `ƒ` unconditionally, and with PPR enabled a route prints `ƒ`
when its static shell is empty or when it is a dynamic app route that did not
postpone, and `○` when nothing postponed. **A PPR-enabled route can legitimately
never print `◐`**, so do not conclude from the legend alone.

**Build artefact.** `routes-manifest.json`'s `rsc` block carries
`clientParamParsing: true` when `cacheComponents` is on, alongside
`didPostponeHeader: 'x-nextjs-postponed'` and the `varyHeader` list. That is
the config-level tell, independent of any single request.

**Not a tell.** The dev-overlay route indicator renders only "marked as static"
or "marked as dynamic"; it has no Partial Prerender state. Use the headers or
the build output.

- <https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents> ·
  <https://nextjs.org/docs/app/guides/streaming#verifying-that-streaming-works>

## Sources

Several claims above are read from source because the published docs state
otherwise - `beforeInteractive` blocking hydration, and missing `subsets` being
an error rather than a warning. Where a claim is behavioural rather than
documented, re-check it against these paths at the tag you are running:

- next/font: `packages/font/src/{google,local}/loader.ts`,
  `packages/font/src/google/{get-google-fonts-url,find-font-files-in-css}.ts`,
  `packages/next/src/build/webpack/loaders/next-font-loader/{index.ts,postcss-next-font.ts}`,
  `packages/next/src/build/webpack/plugins/next-font-manifest-plugin.ts`,
  `crates/next-api/src/font.rs`
- head, CSS and font emission: `packages/next/src/server/app-render/{get-layer-assets,render-css-resource,get-preloadable-fonts}.tsx`,
  `.../app-render/rsc/preloads.ts`
- scripts: `packages/next/src/client/{script.tsx,app-bootstrap.ts}`
- images: `packages/next/src/shared/lib/get-img-props.ts`,
  `packages/next/src/client/image-component.tsx`
- client-only rendering: `packages/next/src/shared/lib/lazy-dynamic/loadable.tsx`,
  `packages/next/src/shared/lib/dynamic.tsx`
- PPR probes: `packages/next/src/client/components/app-router-headers.ts`,
  `packages/next/src/build/{utils.ts,generate-routes-manifest.ts}`
- React's head ordering and hoisting rules:
  `react-dom-bindings/src/server/ReactFizzConfigDOM.js` (`writePreambleStart`,
  `preload`), `.../client/ReactFiberConfigDOM.js` (`isHostHoistableType`),
  `.../shared/crossOriginStrings.js`
- <https://github.com/vercel/next.js> · <https://github.com/facebook/react>
