# Self-hosted font loading

Hand-wired `@font-face` (no framework font layer). Examples use
`@fontsource` + Vite `?url`, but the rules - per-weight preload, crossOrigin,
exact-file matching, metric fallbacks, subsetting - are the browser's and hold
on any stack that ships its own webfonts. Fonts loaded from a hosted CDN
(Google Fonts `css2` links, Bunny, etc.) have different mechanics - preconnect
pair, `display=` param, un-preloadable file URLs - see **hosted-fonts.md**.

> **Astro 6+: prefer the built-in Fonts API first.** Stable since Astro 6.0
> (experimental from 5.7): a top-level `fonts` array + `fontProviders` in
> `astro.config`, then `import { Font } from "astro:assets"` and
> `<Font cssVariable="--font-display" preload />` in the head. It automates
> self-hosting (files cached under `_astro/fonts`), opt-in per-font preload,
> and `optimizedFallbacks` metric-matched fallbacks (default on). It does
> **not** subset - the subsetting + coverage-guard sections below still apply
> on Astro 6. Hand-wire the rest of this file on Vite, Worker-SSR, or pre-6
> Astro. See framework-automation.md for the row-by-row boundary.

## Rules

- **Preload the exact above-the-fold weights, per weight.** Fonts are per-weight
  woff2 files. Preloading 400 does nothing for 500/600 text. Enumerate what the
  above-the-fold header/hero actually renders (map Tailwind utilities:
  `font-medium`->500, `font-semibold`->600) and preload each. The Tailwind
  weight->number scale is identical across v3 and v4 (thin=100 ... normal=400,
  medium=500, semibold=600, bold=700 ... black=900); only the customisation
  mechanism changed (v3 `theme.fontWeight`; v4 `--font-weight-*` CSS vars +
  `font-[<value>]` arbitrary syntax).
  - <https://tailwindcss.com/docs/font-weight> ·
    <https://v3.tailwindcss.com/docs/font-weight>

- **`?url` = exact-file matching.** `import x from ".../file.woff2?url"` in Vite
  yields the same fingerprinted path the fontsource `@font-face src` requests, so
  the preload hits that exact file (no double fetch). A near-miss = two fetches and
  a wasted preload. Verify per verify.md #2. The same hash gotcha bites Fontaine
  (silent no-op if it cannot resolve the hashed path).

- **`crossorigin="anonymous"` is mandatory on font preloads, even same-origin.**
  Fonts are fetched in anonymous-CORS mode (request mode `cors`, credentials
  `same-origin`) - normatively specified in CSS Fonts L4 §4.8.2, and it applies
  same-origin too. A `<link rel=preload as=font>` without `crossorigin` defaults to
  `no-cors`; the HTML preload record keys on credentials mode, so it does not match
  the `@font-face` fetch and is not reused - the file is fetched twice. Fix: bare
  `crossorigin`. State it precisely: "the preload's credentials mode does not match
  the anonymous-CORS mode the `@font-face` fetch uses, so the preload record is not
  reused" - do NOT say browsers "special-case" or "ignore crossorigin on font
  preloads" (they honour it normally; the always-anonymous behaviour lives on the
  `@font-face` fetch, which is exactly why you must add the attribute). Chrome logs
  `A preload for '...' is found, but is not used because the request credentials
  mode does not match` ~3s after load.
  - <https://drafts.csswg.org/css-fonts-4/#font-fetching-requirements> ·
    <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload>
    ("needs to be set to match the resource's CORS and credentials mode, even when
    the fetch is not cross-origin") ·
    <https://web.dev/articles/codelab-preload-web-fonts> · closed spec issue:
    <https://github.com/whatwg/html/issues/7627>

- **Metric-matched fallback `@font-face`.** A local fallback (e.g. Georgia) with
  `size-adjust` + `ascent-override` + `descent-override` tuned to the real face
  stops reflow on swap - turning a layout jump into (at worst) an appearance
  shimmer. Highest-leverage anti-CLS technique for self-hosted fonts. It is exactly
  what `next/font`'s `adjustFontFallback` generates (both `next/font/google`, from
  `capsize-font-metrics.json`, and `next/font/local`, via fontkit, use the identical
  Capsize-derived algorithm, falling back to Arial/Times New Roman by generic
  family).
  - **Safari caveat**: through Safari 26/27, WebKit supports `size-adjust` but
    ignores `ascent-override`/`descent-override`/`line-gap-override` (WebKit
    bug 219735), so a tuned fallback still shifts there - and size-adjust
    *alone* can be worse than nothing (it scales width and height with no
    height correction). If Safari shift matters, gate the block: feature-detect
    with JS (`'ascentOverride' in new FontFace('t', 'local(Arial)')`) or the
    `@supports (overflow-anchor: auto)` proxy - `@supports` cannot test font
    descriptors, and Safari is the one evergreen without `overflow-anchor`.
  - **Pick the fallback per generic family**: derive a serif face's fallback
    from a serif base (Georgia / Times New Roman), a sans face's from Arial. A
    global generator config like fontaine's `fallbacks: ['Arial']` silently
    builds a serif family's (e.g. Fraunces) fallback on Arial metrics -
    per-family config or per-family generator runs avoid it.
  - <https://github.com/vercel/next.js/blob/canary/packages/next/src/server/font-utils.ts>

- **Serve woff2 as-is.** The format is Brotli-compressed internally;
  re-compressing (gzip or br at the CDN/server) wastes CPU for ~0 gain and can
  add bytes. Exclude `*.woff2` from blanket compression rules.

## The metric-fallback mechanic (so you can verify any generator)

`ascent-override` / `descent-override` / `line-gap-override` set the line-box
metrics as a `<percentage>` of em. `size-adjust` (%, initial 100%) multiplies **all**
metrics *including those overrides* - that clause is the load-bearing bit. It is why
generators divide the raw metric by `unitsPerEm * sizeAdjust`, pre-compensating so
ascent/descent land correctly after size-adjust re-multiplies. `size-adjust` itself
is a general scale factor over all the fallback's metrics; generators *derive its
value* from the average-advance (`xWidthAvg`) ratio between the two faces, so the
scaled fallback occupies the same horizontal run as the webfont. The next/font
formula:

```text
sizeAdjust = (mainAvgWidth / mainUnitsPerEm) / (fallbackAvgWidth / fallbackUnitsPerEm)
ascent-override  = |mainAscent  / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
descent-override = |mainDescent / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
lineGap-override = |mainLineGap / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
```

The element-level CSS property `font-size-adjust` (Baseline 2024) is a
complement, not a replacement: it normalises **x-height** between whatever face
is currently rendering and the declared size - useful when the swap's visual
jar is x-height, since the descriptors above tune line-box metrics, not glyph
proportions.

- <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust> ·
  <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/ascent-override> ·
  <https://drafts.csswg.org/css-fonts-5/#size-adjust-desc> ·
  <https://developer.mozilla.org/en-US/docs/Web/CSS/font-size-adjust>

## Generating the overrides (don't hand-compute)

Ranked for a self-hosted fontsource + Vite stack. **These tools cover ONLY the
fallback rule** - per-weight preload, crossOrigin, `?url` matching and subsetting
stay the hand-rolled core. Fontsource ships files + plain `@font-face` only, NO
metric fallbacks.

1. **Fontaine Vite plugin** (`unjs/fontaine`) - near-zero-config, best fit. Scans
   your existing `@font-face` rules, reads the real woff2 via `@capsizecss/unpack`,
   and emits a `<Family> fallback` `@font-face` with computed
   ascent/descent/line-gap-override (+ size-adjust). Same `?url`/hash exact-file
   gotcha applies. Collapses ONE rule, not the skill.

   ```ts
   FontaineTransform.vite({
     fallbacks: ['Georgia'],
     resolvePath: id => new URL('./public' + id, import.meta.url),
   })
   ```

2. **`@capsizecss/core` `createFontStack([unpack.fromFile(real), metrics.georgia])`**
   - programmatic, if you want to commit the CSS yourself. `@capsizecss/unpack` reads
   metrics off your own woff2; `@capsizecss/metrics` supplies system-font metrics.
3. **screenspan.net/fallback** or **Malte Ubl's calculator** - manual/visual, but
   Google-font-oriented (they do not read a bespoke serif file), so weaker here.

- <https://github.com/unjs/fontaine> ·
  <https://github.com/seek-oss/capsize/blob/master/packages/core/src/createFontStack.ts> ·
  <https://developer.chrome.com/blog/framework-tools-font-fallback>

## font-display strategy (once metrics are matched)

Three-phase timeline: **block** period (invisible fallback = FOIT) -> **swap** period
(visible fallback = FOUT) -> failure. Per value: `block` ~3s block + infinite swap
(FOIT); `swap` 0ms block + infinite swap (immediate FOUT, always swaps); `fallback`
100ms block + ~3s swap; `optional` 100ms block + **no** swap (drops the font for this
load if not ready).

**Verdict:** metric-matched + preloaded **`swap` is the default** - ~0 CLS AND the web
font is guaranteed to appear for every first-load user; preloading the exact weight
kills the residual shimmer. `optional` does *not* strictly beat swap: it guarantees
zero swap but risks the real font never showing on a slow first load (fallback locked
in; the real font only appears on a later cached navigation). Chrome 83+ renders
preloaded `optional` with zero shift. web.dev's hybrid: `optional` for body, `swap`
for branding/headings.

- <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display> ·
  <https://web.dev/articles/font-best-practices> ·
  <https://web.dev/articles/preload-optional-fonts>

## Variable fonts dodge the per-weight preload problem

One variable woff2 with `@font-face { font-weight: 100 900; src: url(...)
format('woff2') }` supplies every weight from one file, so you preload **one** file
for all above-the-fold weights. Caveats: (1) a variable file is larger than any single
static weight - break-even is ~3 weights (font-specific, not a hard rule); for 1-2
weights a subset static is smaller. (2) subsetting still applies and is the bigger
byte lever. (3) all weights share one cache entry (good for preload; can't skip unused
weights). (4) use `format('woff2')`, not legacy `format('woff2-variations')`.

- <https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide>

## Subsetting

`@fontsource` splits by subset (latin / latin-ext / vietnamese / greek ...). Preload only
the subset(s) actually rendered above the fold (usually latin), and only the weights in
that subset - subsetting is a larger byte lever than variable-vs-static. `unicode-range`
on each `@font-face` lets the browser fetch only the subset a page needs.

### Measure the real file first - the big-savings ratio is usually a myth

The "300KB -> 20KB" subsetting win assumes you start from a full, unsubset face.
If the source is already a per-subset `@fontsource` `latin` file, most of that
win is *already banked* - the variable axis is pinned and the script is Latin.
Re-subsetting one of those buys the tail: the General-Punctuation /
arrows / maths block the `latin` subset still carries but English copy never
renders (e.g. Inter `latin` ~48KB -> ~34KB re-subset, not ~48KB -> 5KB). So
**measure the actual bytes before promising a ratio** (`ls -l` the woff2, or
DevTools Network); quote the real before/after, not a generic multiplier. The
byte ceilings in `scripts/check-dist.mjs` exist precisely to catch a
regeneration that silently drops the subsetting and reships the full face.

### Safe subsetting needs a coverage guard scoped to text ranges

Subsetting fixed copy is safe **only** if a check proves every rendered glyph is
still in the subset - otherwise a later headline edit introduces one accented
loanword that silently drops to the fallback face. Two halves:

1. **Extraction** - which glyphs the copy actually uses. glyphhanger / subfont
   can scan rendered pages and drive the subsetter; that covers the "what to
   keep" half.
2. **The guard** - a build-time assertion that rendered copy stays inside the
   kept ranges. Scope it to the ranges the *text* fonts own: Latin + typographic
   punctuation + currency. Decorative symbols (arrows U+2190+, dingbats, emoji)
   are deliberately left to the system font - they were never in the `latin`
   subset either - so the guard must flag a dropped accented **letter** loudly
   while *not* failing on an intentional decorative glyph.

Keep the ranges in **one shared module** that both the subset generator and the
guard import, so the shipped woff2 and the assertion can't drift.
`scripts/font-subset.config.mjs` is a template for that module (glyph ranges +
text-scope ranges + `pyftsubset --unicodes` / CSS `unicode-range` string), and
`verify.md` Tier 0 wires the assertion. Note the `--flavor`/`--unicodes` option
names on `pyftsubset` are US-spelled - a locale spell-checker that "corrects"
them breaks the build (see the mechanical-enforcement locale caveat).
