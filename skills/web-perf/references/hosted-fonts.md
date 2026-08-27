# Hosted font CDNs (Google Fonts et al.): de-jank an existing head

fonts.md assumes you self-host. This file covers the other common shape: fonts
loaded from a hosted CDN - Google Fonts' `<link href="...css2?family=...">` is
the canonical case; Bunny Fonts and similar share the mechanics; Adobe Fonts
(Typekit) differs enough to get its own section below. Two moves are
available: **de-jank the CDN wiring in place** (this file) or **migrate to
self-hosting** (usually the better fix - see the last section; not licensed
for Adobe Fonts).

## The two-hop waterfall you are starting from

A hosted Google Fonts head serialises two render-relevant hops:

1. `fonts.googleapis.com/css2?...` - a render-blocking stylesheet request that
   returns UA-tailored `@font-face` CSS;
2. `fonts.gstatic.com/...woff2` - the font files that CSS points at, only
   discoverable after hop 1 parses.

Each hop is a separate origin (DNS + TCP + TLS) on a cold load. That is the
baseline cost of the CDN approach; the fixes below trim it, self-hosting
removes it.

## `display=swap` must be REQUESTED

The `font-display` in Google's generated CSS comes from the `display=` URL
parameter, and it defaults to `auto` - block-like FOIT. A css2 URL without
`&display=swap` holds text invisible while the font loads. Check the URL
first; it is the cheapest fix in this file. (`display=optional` is also
valid, with the same trade-offs as fonts.md's font-display section.)

## The correct preconnect pair (two tags, one crossorigin)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

- `fonts.googleapis.com` serves CSS - a plain fetch, **no** `crossorigin`.
- `fonts.gstatic.com` serves the fonts - always fetched anonymous-CORS (see
  fonts.md), so its preconnect **must** carry `crossorigin` to warm the socket
  the font fetch will actually use.
- Keep them separate `<link>` tags. With hosted fonts this pair IS
  load-bearing - the "preconnect is pure waste" rule in resource-hints.md
  applies to self-hosted fonts only.

## You cannot reliably hand-preload the gstatic woff2

The woff2 URLs live inside Google's generated CSS and vary by UA and over
time - Google serves different files/formats per browser and rotates asset
paths. A hard-coded `<link rel=preload as=font href="https://fonts.gstatic.com/...">`
works today, silently 404s or double-fetches later. Preconnect to gstatic is
the reliable hint; exact-file preload is a self-hosting privilege.

## `@import` inside CSS is the worst version

```css
/* styles.css line 1 - do not do this */
@import url("https://fonts.googleapis.com/css2?family=...&display=swap");
```

An `@import` inside a stylesheet is invisible to the preload scanner and
serialises a THIRD hop: fetch + parse `styles.css` -> discover the fonts CSS ->
fetch it -> discover the woff2 -> fetch it. Replace with parallel `<link>`
tags in `<head>` (preconnect pair + stylesheet link), or self-host. Confirm in
the DevTools Network waterfall: the fonts CSS request should start with the
document, not after your stylesheet.

## The `media="print"` onload trick (non-blocking, with a trade-off)

```html
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=...&display=swap">
```

`media="print"` makes the stylesheet non-render-blocking; the `onload` flips
it live. First paint stops waiting for Google - but text now renders in the
fallback face first and restyles when the CSS lands (a guaranteed FOUT, and a
layout shift too unless you add the metric fallback below). Reasonable for
below-the-fold or decorative faces; for the primary text face, prefer
migrating to self-host over trading blocking for flashing.

## Metric-matched fallback: you must author it yourself

You do not own Google's CSS, so nothing in it will ever contain a
metric-matched fallback face - the CDN path leaves swap-CLS unfixed by
default. Author your own fallback `@font-face` (it lives in YOUR css, keyed to
the same family name) with fontpie or Capsize against the same font file, and
put it after the real family in the stack. Mechanics and Safari caveat:
fonts.md.

## Adobe Fonts (Typekit): same shape, different levers

Adobe Fonts kits share the two-hop mechanics above but differ where it
matters:

- **Two embed forms, same kit ID.** The legacy embed is a *synchronous JS
  kit* (`<script src="https://use.typekit.net/<kit>.js"></script>` +
  `Typekit.load()`) that render-blocks head and self-expires quickly
  (`max-age=600`); the modern embed is a plain CSS link,
  `https://use.typekit.net/<kit>.css`, **with the same kit ID** - swapping
  script for link is usually a drop-in de-jank. The JS kit's `wf-loading` /
  `wf-active` font-event classes are the only thing lost; grep for them
  before assuming nothing depends on them. Behavioural difference that bites
  tests and measurement code: the JS kit *actively* loads every kit face;
  the CSS embed loads faces on use, so a page that never renders a kit
  family never loads it.
- **`font-display` is a per-kit DASHBOARD setting - no URL parameter.**
  Unlike Google's `display=` param, you cannot fix FOIT from the embed code;
  it is set in the web-project settings by whoever owns the kit (often a
  designer, not the site owner). Kits default to `auto` (FOIT). If you don't
  own the kit, this is a handover action to record, not an edit.
- **The preconnect set is three tags**: `use.typekit.net` serves both the
  kit CSS (plain fetch) and the woff2 (anonymous-CORS), so it needs BOTH a
  plain and a `crossorigin` preconnect; and the kit CSS *starts* with a
  render-blocking `@import` to `p.typekit.net` (the telemetry/licence
  beacon), which sits on the critical path and earns its own preconnect.
- **Exact-file preload is brittle across republish.** The woff2 URLs contain
  opaque per-publish tokens that change when the kit is republished; a
  hard-coded preload silently 404s later. Preconnect is the reliable hint
  (same caveat class as gstatic above).
- **Self-hosting is usually NOT licensed.** Adobe Fonts licensing ties the
  faces to kit delivery - the "migrate to self-hosting" exit below does not
  apply unless the face is licensed separately. The available levers are the
  embed form, the preconnect trio, and the dashboard `font-display` setting.

## Cloudflare Fonts rewrites the head at the edge

Cloudflare Fonts (zone toggle: Speed > Settings > Content Optimization) removes
the Google Fonts `<link>` from the HTML response and replaces it with inline
CSS pointing at font files served from your own zone under the `/cf-fonts/`
path prefix. It also strips preconnect hints for Google Fonts domains out of
the response body. With it on:

- **The sections above stop describing the shipped page.** Requests to
  fonts.googleapis.com and fonts.gstatic.com disappear, the preconnect pair you
  hand-authored is deleted for you, and the font requests land in your own zone
  analytics.
- **Any check that reads origin HTML asserts on pre-rewrite bytes.**
  `scripts/check-dist.mjs` over a build directory, or `check-head.mjs` against a
  local boot, still sees the Google `<link>` the browser never receives. Fetch
  the URL through the proxy when the gate is about fonts (verify.md).
- **`<link>` form only.** An `@import url('https://fonts.googleapis.com/...')`
  inside a stylesheet is left untouched and keeps hitting Google - one more
  reason to replace it. The trigger is a literal `href` pointing at
  fonts.googleapis.com in the origin HTML, so a site that already self-hosts
  server-side gives it nothing to rewrite. Google Fonts is the only provider
  handled, so an Adobe kit is untouched too.
- **Mutually exclusive with APO.** It does not operate while Automatic Platform
  Optimization is enabled, which performs a similar Google Fonts rewrite.
- **It does not modify CSP**, and its output is an injected inline `<style>` -
  so expect a nonce-or-hash `style-src` to block the injected style (an
  inference from the docs' silence on CSP, not a documented limit - verify on
  the zone; the next section is the diagnosis).
- Requires `unicode-range` + woff2 support (Chrome 36+, Edge 16+, Safari 10+,
  Firefox 44+). Scope it per hostname with a Configuration Rule rather than
  enabling the whole zone. The docs state no plan restriction (as of
  2026-08-27) - confirm the toggle in the dashboard for a given zone.
- <https://developers.cloudflare.com/speed/optimization/content/fonts/>

## CSP `font-src` / `style-src` blocks = permanent fallback

A blocked font neither flashes nor retries. The block/swap/failure periods are
rendering states on a timer, not events, and the spec requires the UA to show
text visibly once a load has failed - so the page renders the fallback family
for the rest of its life and presents as "the typography is wrong". Same
presentation as the dead-token case in symptoms.md's gate before B; there the
face is never requested, here it is refused inside the browser (the request
never leaves - Chrome shows a `(blocked:csp)` Network entry with no response).

- **`font-src`** (falls back to `default-src`) blocks the woff2. Chrome console,
  source `security`: `Loading the font 'https://.../f.woff2' violates the
  following Content Security Policy directive: "font-src 'self'". The action has
  been blocked.` A log grep for the older wording, "Refused to load the font",
  misses current Chrome. The message quotes the raw directive that did the
  blocking, so under a default-src-only policy it reads `"default-src 'self'"`,
  with a note that `font-src` fell back to it.
- **`style-src`** blocks the kit stylesheet or an inline `<style>`, and that is
  the strictly worse case: the `@font-face` rules never exist, so
  `document.fonts` is empty and no font-loading event fires at all. Font
  instrumentation is blind and the console entry is the only page-visible
  signal (`Loading the stylesheet '...' violates ...`; for inline, `Applying
  inline style violates ... 'style-src 'self''`, naming the hash it wants).
- **Confirm**: DevTools console (`security` source) and the Issues panel - every
  violation also fires `securitypolicyviolation` on `document`, whose
  `effectiveDirective` (`font-src`; `style-src-elem` for a stylesheet,
  `style-src-attr` for a style attribute) and `blockedURI` name what was
  refused. That event is the discriminator available to page JS, because a
  `font-src` block leaves the same deceptive font-API trace as the missing-ACAO
  case (fonts.md's server-side twin); outside the page, CDP's
  `Network.loadingFailed` distinguishes `blockedReason: "csp"` from a CORS
  failure. Message text above is Chromium 151 (as of 2026-08-27); Firefox and
  WebKit word theirs differently.
- **Fix**: list the delivering origins in `font-src`, and the stylesheet host in
  `style-src`. Self-hosting collapses both to `'self'`.
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/font-src> ·
  <https://drafts.csswg.org/css-fonts-4/#font-display-timeline>

## The usually-right fix: migrate to self-hosting

Every section above trims a cost that self-hosting deletes: same-origin files
(no preconnect needed), exact-file preload (`?url`), your own `@font-face`
(metric fallback, `font-display`, `unicode-range` under your control), and
immutable caching via your own headers. Do not hold back for the shared-cache
myth - "the Google font is probably cached from another site" has been false
since HTTP cache partitioning (Chrome 86 / Firefox 85; Safari long before):
the cache is keyed per top-level site, so every site pays the CDN's cold
two-origin cost for every new visitor. Two migration paths by stack: on a
bundler stack, `@fontsource` packages make it mostly mechanical - install the
package, import the weights you use, delete the CDN links. On a **no-build or
non-JS site** (hand-wired HTML, plain SSG with no package manager),
google-webfonts-helper emits the woff2 files plus ready-to-paste `@font-face`
CSS - pick its Modern (woff2-only) output. Either way, then apply fonts.md end
to end. Privacy is a bonus: no per-pageview font requests to a third party. LG
München I (20 January 2022, 3 O 17493/20) awarded EUR 100 plus an injunction
against a site loading hosted Google Fonts without consent; German rulings
since have split, and the BGH referred the underlying questions to the CJEU on
28 August 2025 (VI ZR 258/24), still pending.

- <https://developers.google.com/fonts/docs/css2> ·
  <https://fontsource.org/docs/getting-started/introduction> ·
  <https://gwfh.mranftl.com> (google-webfonts-helper, no-build) ·
  <https://web.dev/articles/font-best-practices>
