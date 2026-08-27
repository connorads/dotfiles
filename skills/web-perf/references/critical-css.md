# Critical CSS: inline the above-the-fold set, defer the rest

`symptoms.md` B3 and C1 both prescribe this fix; this file owns it. It names
which tool performs the pass, what that tool's output is actually made of, how
the deferred half is delivered, and the one lever that runs the other way.

The two symptoms are one lever at opposite settings: a render-blocking
`<link rel=stylesheet>` holds first paint and the page is blank (C1), a deferred
one lets content paint before its rules apply and the section flashes unstyled
(B3). **Shipping half the fix converts one symptom into the other** - deferring
a stylesheet without inlining a critical set is exactly B3.

## Contents

- [When it applies](#when-it-applies)
- [Default: beasties over prerendered output](#default-beasties-over-prerendered-output)
- [Escape hatches, condition first](#escape-hatches-condition-first)
- [Delivering the deferred half](#delivering-the-deferred-half)
- [The inverse lever: `blocking="render"`](#the-inverse-lever-blockingrender)
- [What not to do](#what-not-to-do)
- [Sources](#sources)

## When it applies

**The diagnosed cause must be the stylesheet.** C1 qualifies when the blank
period ends as the sheet's response completes; B3 qualifies when the unstyled
frame precedes it. A blank owed to a hydration bundle, or content held at
`opacity: 0` until JS (B7), does not move - and the reverse also happens:
un-gating a reveal can expose render-blocking CSS as the paint's real bound
(SKILL.md's reveal-gating note), which routes back here.

**Two standing costs, so this is not a free win.** Inlined CSS is not cached for
subsequent pages, because HTML often cannot be cached for long or at all, and
the inline bytes enlarge the initial HTML response - both named by web.dev's
resource-loading module. The fix therefore pays on a landing page or any route
dominated by first visits, and loses across a deep multi-page journey where one
well-cached external stylesheet already serves every page.

**Then lock the posture down.** Once critical CSS is inlined, Tier 0 asserts
that no *render-blocking* stylesheet link survives the build (`verify.md`) - a
config change otherwise brings the blocking request back with no other symptom.
Scope the matcher to blocking sheets only: the shipped `check-dist.mjs`
template matches every `rel="stylesheet"`, so the deferred sheet this file
recommends (a `media="print"`/`onload` link, or beasties' body-appended clone)
must be exempted when adopting that gate.

## Default: beasties over prerendered output

[beasties](https://github.com/danielroe/beasties) is a **post-build pass over a
complete HTML document**: `new Beasties(opts)`, then
`await beasties.process(html)` returns the rewritten HTML with a `<style>` in
the head and the external sheet demoted. It is the maintained fork of
GoogleChromeLabs/critters, which is archived read-only (Oct 2024) and deprecated
on npm pointing here. Current release 0.4.3 as of Aug 2026; re-check with
`pnpm info beasties version`.

**Know what the output actually is.** beasties uses no headless browser - it
reconstructs the DOM from the input HTML and evaluates CSS selectors against it.
That is the whole speed argument, and the whole limitation, which the project
states plainly: it "inlines all CSS rules used by your document, rather than
only those needed for above-the-fold content", and is "not aware of viewport
size and what specific nodes are above the fold". So it performs **used-CSS
extraction, not critical-path extraction**. On a page whose whole stylesheet is
used somewhere, the inline block is the stylesheet.

**`data-beasties-container` is the only fold approximation available.** Mark the
top-level element(s) holding above-the-fold content and only CSS matching inside
those containers is inlined. Multiple containers are allowed and a rule inlines
if it matches inside any of them, which is how disconnected above-fold regions
(a header plus a hero, say) are covered. Reach for it whenever the used set and
the visible set diverge.

Three overrides for what the selector walk gets wrong: the CSS comments
`/* beasties:exclude */` and `/* beasties:include */`; `allowRules` for
selectors that must always be inlined (JS-added classes, state the initial DOM
does not carry); and `data-beasties-skip` on a `<link>`, so that tag is not
read, inlined, pruned or mutated at all whatever the preload strategy is.

**Wire it through the first-party plugin rather than the API.**
`vite-plugin-beasties` and `beasties-webpack-plugin` live in the same monorepo
at the same version. The Vite plugin runs inside `transformIndexHtml`, so it is
bundle-aware: it flips `pruneSource` to `true` (the library default is `false`,
which leaves every inlined rule duplicated in the external file), points
beasties' `path` at `build.outDir` and `publicPath` at `config.base`, filters to
`*.html`, and deletes stylesheet assets that ended up fully inlined. Those are
the settings you would otherwise have to get right by hand.

## Escape hatches, condition first

- **The stack ships its own inlining -> use it, do not add a second pass.**
  Next: `next.md`'s CSS delivery section owns the levers and their limits
  (`experimental.inlineCss` on App Router; `experimental.optimizeCss`,
  Pages Router only, still runs the archived `critters`). TanStack Start:
  `server.build.inlineCss`, in `tanstack.md`. Angular's
  `inlineCritical`/`inlineCriticalCss` optimisation *is* beasties -
  `@angular/build` depends on it directly, and it defaults to on, so Angular
  readers need no extra pass - and the mechanism and container caveat above
  apply unchanged. Nuxt's `@nuxtjs/critters` module keeps the old
  name and runs beasties underneath; its built-in `features.inlineStyles` is a
  **different** mechanism - per-component style inlining for `.vue` ids under
  production SSR - so do not read one as the other.
- **One page, one small stylesheet -> hand-inline and ship no external sheet.**
  A `<style>` in `<head>` is the entire fix, with no build step to maintain or
  drift. Astro exposes the same move as a flag,
  `build.inlineStylesheets: 'always'` - the `'auto'` threshold trap is in
  `symptoms.md` C1.
- **The fold genuinely decides the answer -> a headless-browser extractor.**
  `critical` (8.0.0, maintained) renders at a real viewport via
  penthouse-esm/puppeteer and supports multiple screen resolutions, at the cost
  of a browser in the build. Its `master` README documents a two-engine
  static/Playwright design belonging to an **unreleased** 9.0.0-next.0 - do not
  cite that as shipped behaviour.
- **The HTML streams -> nothing here applies.** `beasties.process()` needs the
  whole document before it can rebuild the DOM and rewrite `<head>`, so it fits
  prerendered, exported or fully-buffered output only (Next's `optimizeCss`
  is likewise Pages-Router-only - next.md). Reach instead
  for what the streamed mode does offer: shell-side delivery and React 19's
  suspend-until-the-sheet-loads reveal (`static-vs-ssr.md`). On React 19,
  `preinit(href, { as: 'style' })` before the shell flush is the in-framework
  way to ship a sheet render-blocking rather than inlined - phase rules and the
  after-flush degradation are in `resource-hints.md`.

## Delivering the deferred half

Two patterns exist, and current guidance disagrees with itself about which.
web.dev's "Defer non-critical CSS" leads with a `rel=preload` plus
`onload="this.rel='stylesheet'"` swap and refers production users to loadCSS -
but that page dates from 2019 and loadCSS is archived and unmaintained (last
commit 2022), its own README having settled on the other pattern:

```html
<link rel="stylesheet" href="/rest.css" media="print"
      onload="this.media='all'; this.onload=null;">
<noscript><link rel="stylesheet" href="/rest.css"></noscript>
```

**Hand-wiring: default to the print-media swap.** Filament Group's reasoning
is the same zero-sum argument `resource-hints.md` makes about budget: preload
fetches very early at the highest priority, potentially deprioritising other
important downloads, whereas the media toggle is simpler and declarative.
(hosted-fonts.md applies the same swap to the Google Fonts stylesheet and owns
that case's verdict.) **Under beasties, the library default already needs no
JS**: the `preload: false` strategy emits a head preload plus a stylesheet
clone appended to `<body>`, no `onload` and no `<noscript>` needed. Its
`media` strategy is the print-swap shape - the shipped 0.4.3 emits
`media="print"` + `onload="this.media='all'"` and removes nothing, whatever
older READMEs say - and `js`/`js-lazy` variants need JS by construction.

Two caveats hold for either pattern:

- **The `<noscript>` duplicate is load-bearing, not decorative.** Every strategy
  bar beasties' default and `body` needs JS to finish the job: without it the
  preload variant never becomes a stylesheet and the print variant stays a
  print-only stylesheet. beasties adds the `<noscript>` fallback itself unless
  `noscriptFallback` is off.
- **Deferring is FOUC-by-design for whatever the critical set missed.** That is
  not a bug in the pattern; it is why the two halves ship as one change.

## The inverse lever: `blocking="render"`

The opposite need - a resource that *must* be applied before anything paints, at
the cost of paint - is `blocking="render"`, and the honest default is
csswizardry's: unless you know you need this behaviour, you do not.

Mechanics, from the spec:

- `render` is the only defined blocking token, and `blocking` on `<link>` is
  valid **only with `rel=stylesheet` or `rel=expect`**. On `rel=preload` it is
  out of the spec, because it would block render on fetch completion rather than
  on apply, which risks the FOUC it was meant to prevent.
- A parser-created `<style>` is *implicitly* potentially render-blocking, so the
  attribute is only needed on a script-inserted `<style>` or `<link>` - the case
  MDN calls out.
- It is head-only and one-shot: a document accepts render-blocking elements only
  while its `body` is null, so the attribute is inert once `<body>` exists.
- The block is additionally capped by an **implementation-defined timeout** with
  no numeric value in the spec. That unbounded duration is the risk: the one
  use case csswizardry finds compelling, A/B-test anti-flicker, trades a
  four-second anti-flicker timeout for browser heuristics. For web fonts he
  explicitly does not recommend it, `font-display: block` giving similar
  behaviour with a three-second bound (`fonts.md` owns that choice).

Support, as of Aug 2026: Baseline limited on `<link>`, `<script>` and `<style>`
alike - Chrome/Edge 105 (Sep 2022), Safari 18.2 (Dec 2024), **Firefox the only
holdout** (bugzil.la/1751383). So do not describe it as Chromium-only; the
articles that do predate Safari 18.2. Its spec-blessed replacement for the
removed preload behaviour, `<link rel="expect">`, *is* genuinely Chromium-only
(Chrome 124+), and is the mechanism that gates first paint on a Next App Router
document - `next.md`.

## What not to do

- **Preload every stylesheet.** Preload governs discovery and priority, never
  application: a preloaded sheet still is not applied, and the budget is
  zero-sum, so preloading the deferred CSS puts it back in contention with the
  critical path (`resource-hints.md`).
- **Inject the CSS from JS** - a `<style>` appended by client script, or a route
  sheet imported lazily after mount. That is the B3 *cause*: it flashes, and
  with no JS it never applies at all.
- **Take a tool list from a 2019 article.** web.dev's "Extract critical CSS"
  recommends three, of which `criticalcss` last published in 2016 and
  `penthouse` last published in 2022 still pinned to puppeteer 2.1.1 (its live
  lineage is the `penthouse-esm` fork that `critical` consumes). And do not add
  `critters` to a project - archived upstream, deprecated on npm, pointing at
  beasties.

## Sources

- <https://github.com/danielroe/beasties> ·
  <https://github.com/danielroe/beasties/blob/main/packages/beasties/README.md> ·
  <https://github.com/danielroe/beasties/blob/main/packages/vite-plugin-beasties/src/index.ts> ·
  <https://github.com/GoogleChromeLabs/critters>
- <https://github.com/addyosmani/critical> · <https://github.com/nuxt-modules/critters> ·
  <https://github.com/nuxt/nuxt/blob/main/packages/schema/src/config/experimental.ts> ·
  <https://www.npmjs.com/package/@angular/build>
- <https://web.dev/articles/defer-non-critical-css> ·
  <https://web.dev/learn/performance/optimize-resource-loading> ·
  <https://web.dev/articles/extract-critical-css> ·
  <https://www.filamentgroup.com/lab/load-css-simpler/> ·
  <https://github.com/filamentgroup/loadCSS>
- <https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-attributes> ·
  <https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism> ·
  <https://html.spec.whatwg.org/multipage/semantics.html#attr-link-blocking> ·
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link> ·
  <https://webstatus.dev/features/blocking-render> ·
  <https://csswizardry.com/2024/08/blocking-render-why-whould-you-do-that/>
