# Self-hosted font loading (fontsource + Vite)

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
  - <https://github.com/vercel/next.js/blob/canary/packages/next/src/server/font-utils.ts>

## The metric-fallback mechanic (so you can verify any generator)

`ascent-override` / `descent-override` / `line-gap-override` set the line-box
metrics as a `<percentage>` of em. `size-adjust` (%, initial 100%) multiplies **all**
metrics *including those overrides* - that clause is the load-bearing bit. It is why
generators divide the raw metric by `unitsPerEm * sizeAdjust`, pre-compensating so
ascent/descent land correctly after size-adjust re-multiplies. `size-adjust` itself
is an average character **width** ratio (`xWidthAvg` / average advance), despite the
name suggesting overall size. The next/font formula:

```text
sizeAdjust = (mainAvgWidth / mainUnitsPerEm) / (fallbackAvgWidth / fallbackUnitsPerEm)
ascent-override  = |mainAscent  / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
descent-override = |mainDescent / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
lineGap-override = |mainLineGap / (mainUnitsPerEm * sizeAdjust)|  as toFixed(2)%
```

- <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust> ·
  <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/ascent-override> ·
  <https://drafts.csswg.org/css-fonts-5/#size-adjust-desc>

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

fontsource splits by subset (latin / latin-ext / vietnamese / greek ...). Preload only
the subset(s) actually rendered above the fold (usually latin), and only the weights in
that subset - subsetting is a larger byte lever than variable-vs-static. `unicode-range`
on each `@font-face` lets the browser fetch only the subset a page needs.
