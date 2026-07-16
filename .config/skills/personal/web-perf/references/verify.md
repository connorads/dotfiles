# Verify a loading fix (cold cache)

The lens no other loading skill carries. A perf fix you did not observe is a
guess. Every fix in this skill has a matching check here; scale the check to the
stakes (a preload count is a curl; a CLS claim wants a probe).

## Contents

- [1. First: which artifact are you asserting on?](#1-first-which-artifact-are-you-asserting-on)
- [2. Tier 0 - static / prerender: assert on the built HTML directly](#2-tier-0---static--prerender-assert-on-the-built-html-directly)
- [3. Tier 1 - SSR / per-request: boot the route, assert on rendered bytes](#3-tier-1---ssr--per-request-boot-the-route-assert-on-rendered-bytes)
- [4. Shared probes (either tier): cold-cache by eye + CLS/LCP](#4-shared-probes-either-tier-cold-cache-by-eye--clslcp)
- [5. Measurement-tool gotchas (Lighthouse CI / unlighthouse)](#5-measurement-tool-gotchas-lighthouse-ci--unlighthouse)
- [6. DevTools Performance panel](#6-devtools-performance-panel)
- [7. Wire it into the build where it matters](#7-wire-it-into-the-build-where-it-matters)
- [8. Regression-guard the trade-offs](#8-regression-guard-the-trade-offs)

## 1. First: which artifact are you asserting on?

The single question that routes verification: **is the HTML fixed at build, or
rendered per request?** (The `static-vs-ssr.md` axis.)

- **Static / prerender** (Astro/SSG, any prerendered output) - `dist/*.html` IS
  what ships. Assert on the files directly with a Node script: no server, no
  browser, runs in-CI in milliseconds. **Tier 0** below.
- **SSR / per-request** (a Worker/edge or Node server renders the head each
  request) - there is no static file to grep, so boot the route and assert on
  the rendered bytes. **Tier 1** below.

**The split can be per-route, not per-site.** Astro's `prerender` is a
per-route flag, so one build can mix prerendered pages (Tier 0) with SSR
routes (Tier 1) - and the SSR route is often the highest-traffic page. Point
the Tier-0 script at the prerendered subset only; a "static-looking" build
with any SSR routes still needs Tier 1 for those.

Both tiers share the by-eye cold-cache pass and the CLS probe (section 4) -
those drive a real browser and don't care how the HTML was produced (for a
static site, serve `dist` with any static server to give the browser a URL).

## 2. Tier 0 - static / prerender: assert on the built HTML directly

When the build emits the final HTML, the shipped bytes are sitting on disk.
Skip the server and Playwright entirely - read `dist/*.html` in a Node script
and fail non-zero. This is the cheapest, most deterministic tier, and every
byte-level structural invariant belongs here:

- **font preload count within budget** - font preloads are high-priority and
  dispatched immediately, so an extra one steals bandwidth from the critical
  path (budget ~2-3; resource-hints.md).
- **each font preload carries `crossorigin`** - a missing one means a
  credentials-mode mismatch and a double fetch (fonts.md).
- **each preload `href` appears in an inline `@font-face url()` byte-for-byte** -
  a hash drift between the `?url` import and the `@font-face src` = double fetch.
- **metric-matched fallback faces present, carrying `size-adjust`** - the
  fallback generator (e.g. fontaine) silently no-ops when it can't resolve a font
  path, reintroducing swap CLS.
- **no render-blocking `<link rel=stylesheet>`** (where the posture is inlined
  critical CSS) - a config change would quietly bring the blocking request back.
- **subset woff2 under a byte ceiling** - catches a font regeneration that lost
  the subsetting and shipped the full face.
- **rendered copy stays within the subset's glyph coverage, scoped to text
  ranges** - a new accented letter that falls outside the subset silently drops
  to the metric font; decorative symbols/emoji are deliberately left to the
  system font (fonts.md, and the shared coverage module below).

`scripts/check-dist.mjs` + `scripts/font-subset.config.mjs` are drop-in
templates for exactly these checks (adapt the paths, ceilings and ranges per
project; they assume inlined CSS - if your CSS ships as a separate file, read
that file for the `@font-face` cross-check instead of the HTML). In a
per-route hybrid build, run them against the prerendered pages only - the SSR
routes are section 3's job.

**Adapt, don't copy, the matchers.** The template's preload matcher keys on
`rel="preload"` / `as="font"` with **double** quotes and one attribute order; a
build that emits single quotes, unquoted attributes, or a different order will
slip through a naive regex. Match your actual emitted markup (or parse the DOM),
not the template's literal string.

The shared-coverage discipline is the load-bearing bit: the subset generator and
this checker both `import` the *same* coverage module, so the shipped woff2 and
the assertion cannot drift - widen a range, regenerate, and the guard follows.

## 3. Tier 1 - SSR / per-request: boot the route, assert on rendered bytes

When the head is framework-rendered per request (a Worker/edge or Node SSR path;
React 19 may also hoist `<link>` into `<head>`), there is no static file to
grep - boot the app, fetch the rendered HTML for the *actual route*, and assert
on it. Do not trust the source, trust the bytes.

### 3a. Assert on the booted head with `scripts/check-head.mjs`

`scripts/check-head.mjs` is the Tier-1 drop-in template: it fetches a booted
route (URL argument) or reads HTML from stdin, and asserts font preload count
within a `{min,max}` budget, anonymous-only `crossorigin`, and no duplicate
preload hrefs. The structural matchers are **rendering-mode agnostic** - the
same invariants check-dist.mjs asserts on static files hold on per-request
bytes; only the artifact source differs. Fallback-face checks are off by
default (SSR stacks usually ship CSS as external files - assert fallbacks on
the built CSS instead; flip `FALLBACK_FACES` on if your head inlines them).

Worked example - TanStack Start (preloads emitted via the root route's
`head()` option, rendered per request by `<HeadContent />`):

```bash
pnpm dev &                 # or the built preview: node .output/server/index.mjs
node check-head.mjs http://localhost:3000/        # the booted root route
# or, when you already have the bytes:
curl -fsS http://localhost:3000/ | node check-head.mjs
```

Playwright equivalent for a suite that already boots the app (single count
assertion; set N to your budget):

```ts
// React/framework may hoist <link> into <head>, so target rendered DOM, not JSX
await expect(page.locator('head link[rel="preload"][as="font"]')).toHaveCount(N);
```

Gotchas:

- The dev server may bind IPv6/`localhost` only - `127.0.0.1` can fail while
  `localhost` works. Check the port it actually chose (it hops if the default is
  taken), and follow any auth/gate redirect (a pre-auth route may 307).
- Because the head is per-request, curl a booted route (reuse whatever throwaway
  server your test suite already boots), NOT a source template.

### 3b. Confirm no double-fetch (exact-file matching)

The preload `href` must be the *same fingerprinted file* the `@font-face src`
requests. Cross-check the preload hrefs against the built font CSS `url()`s; in
DevTools Network a mismatch shows the same face fetched twice, and Chrome logs
the credentials-mode warning ~3s after load (fonts.md).

## 4. Shared probes (either tier): cold-cache by eye + CLS/LCP

The probes below prove a fix *mechanically* - cold load, one machine. The
shipping verdict is field data: field CLS is the largest session window over the
whole page lifecycle (scroll, interaction, SPA nav), not just first load, so a
lab load-only CLS ~0 can still regress in the field. Before calling a CLS/LCP
regression closed, confirm against real-user p75 (PageSpeed Insights' field
section or the DevTools field-data panel, both CrUX). Ref:
<https://web.dev/articles/cls>.

### 4a. See it cold-cache, by eye

Incognito, or DevTools -> Network -> **Disable cache** + throttle to **3G** -
Chrome's slowest built-in preset (the former "Slow 3G", same 400 Kbps / 2000ms
values; exact dropdown labels vary by DevTools version - pick the slowest preset,
or add a custom profile under Settings > Throttling. The Disable-cache checkbox
sits beside it in the Network action bar). This is the only way FOUT/pop-in reliably
reproduces - warm cache hides it. Toggle OS "Reduce motion" to confirm
reduced-motion paths. For a static build, serve `dist` with any static server to
give the browser a URL.

### 4b. Prove CLS / layout-shift claims (runnable Playwright probe)

Slow-3G CDP values (Puppeteer's preset; Playwright ships none): download = upload =
`((500*1000)/8)*0.8` = 50000 B/s, latency `400*5` = 2000ms. The summed `value` (skip
`hadRecentInput`) is a conservative UPPER BOUND on true CLS (max 5s session window), so
asserting `< 0.1` (or tighter toward 0) is valid and strict. Chromium-only.

```ts
import { test, expect } from '@playwright/test';

const SLOW_3G = {
  offline: false,
  downloadThroughput: Math.trunc(((500 * 1000) / 8) * 0.8), // 50000 B/s
  uploadThroughput: Math.trunc(((500 * 1000) / 8) * 0.8),   // 50000 B/s
  latency: 400 * 5,                                          // 2000 ms
};

test('first-load CLS is ~0 under Slow 3G', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'LayoutShift + CDP are Chromium-only');

  // install the collector BEFORE any navigation, so it is live before first paint
  await page.addInitScript(() => {
    (window as any).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) {
        if (!e.hadRecentInput) (window as any).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  // throttle BEFORE goto
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', SLOW_3G);

  await page.goto('http://localhost:PORT/', { waitUntil: 'load' });
  await page.evaluate(() => (document as any).fonts.ready); // catch font-swap shifts
  await page.waitForTimeout(500);                           // catch late decode shifts

  const cls = await page.evaluate(() => (window as any).__cls);
  expect(cls).toBeLessThan(0.1); // Google "good"; tighten toward 0 as it improves
});
```

Avoid `waitUntil:'networkidle'` (Playwright discourages it); `load` + `fonts.ready` + a
short timeout catches font-swap/decode shifts. Lighthouse and WebPageTest filmstrip
corroborate but iterate slower; PSI adds a CrUX field read (the section-4 verdict)
above its lab run.

- <https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditions> ·
  <https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift> ·
  <https://playwright.dev/docs/api/class-page#page-add-init-script>

### 4c. Prove LCP/FCP claims + attribute a shift to the font swap

Same harness as 4b (collector installed BEFORE navigation, throttle before
`goto`). Two gotchas make LCP different from CLS:

- **LCP must be flushed before you read it** - the browser keeps accepting
  larger candidates until an interaction or the page hides. After `load`,
  `page.click('body')` (or dispatch `visibilitychange` -> hidden), then read
  the *last* entry; a naive post-load read under-reports.
- **Playwright's default headless is `chromium-headless-shell`, not full
  Chrome** - it rasterises fonts/GPU differently, so font-swap visuals and
  screenshot baselines can diverge from what users see. Use
  `channel: 'chromium'` (new headless) when the assertion hangs on rendered
  font pixels.

```ts
await page.addInitScript(() => {
  (window as any).__lcp = 0;
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1) as any;
    if (last) (window as any).__lcp = last.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});
// ...throttle + goto as in 4b, then flush and read:
await page.click('body');                    // user input finalises LCP
const lcp = await page.evaluate(() => (window as any).__lcp);
```

The entry's `element` also proves *what* the LCP is - a text node routes to
symptoms.md C3 (font levers), an `<img>` to C2. For element-level culprits
with less code, inject the `web-vitals` **attribution build** via
`addInitScript` and read its report after the same flush.

### 4d. When `load` never fires: probing a load-gated page

Two probe traps on badly-gated pages (symptoms.md B7 and its load-event
amplifier), where the defect itself breaks the naive harness:

- **Do not `waitUntil: 'load'` on the page you are diagnosing** - under
  Slow-3G a page holding tens of MB of image fetches may never fire `load`
  inside any sane timeout, and the probe times out reporting nothing. Use
  `waitUntil: 'domcontentloaded'` (or `'commit'`), then poll for the visible
  condition (element opacity/visibility via `getComputedStyle`) inside a
  fixed settle window.
- **FCP = 0 after N seconds IS the finding, not a broken probe.** If
  `performance.getEntriesByName('first-contentful-paint')` stays empty for
  the whole budget, record "never painted in Ns" as the measurement - do not
  retry with looser waits until a number appears.
- **Name what holds `load` open.** Log in-flight requests
  (`page.on('request'/'requestfinished')`, or CDP `Network.enable` events)
  and diff the sets at DCL and at your budget cut-off - the survivors (30
  lazy gallery images, an unbounded video manifest) are the reveal's real
  gate when the init runs at `load`.

**Attribute a shift to the font swap**: log each `layout-shift` entry's
`startTime` (4b collector) and compare against when `document.fonts.ready`
resolved - a shift cluster landing at fonts-ready is the swap (fix per
fonts.md A1 levers); one landing at an image response is A2/B5. This turns
"CLS got worse" into a named culprit without a trace.

- <https://developer.mozilla.org/en-US/docs/Web/API/LargestContentfulPaint> ·
  <https://github.com/GoogleChrome/web-vitals#attribution> ·
  <https://playwright.dev/docs/browsers#chromium-new-headless-mode>

## 5. Measurement-tool gotchas (Lighthouse CI / unlighthouse)

When you reach for a runtime tool to corroborate a fix, these traps waste the
most time:

- **Lighthouse 13 renamed the diagnostic audits (Oct 2025).** The classic audit
  names and JSON keys are gone, replaced by insight audits: "Eliminate
  render-blocking resources" -> `render-blocking-insight`; the LCP
  lazy-load/preload pair -> `lcp-discovery-insight` (+ `image-delivery-insight`
  for weight/format); font-display -> `font-display-insight`; unsized-image /
  layout-shift culprits -> `cls-culprits-insight`. The 0-100 performance
  *score* is unchanged (metric-driven) - only the diagnostics moved. LHCI
  assertions keyed on old audit ids fail on Lighthouse 13+; check ids against
  the installed version.
- **Lighthouse budget unit split (bytes vs KiB).** A LHCI `budget.json`
  `resourceSizes` `budget` is in **kibibytes** (`{ "resourceType": "font",
  "budget": 100 }` = 100 KiB). But the assertion form in `lighthouserc.json`
  (`"resource-summary:font:size": ["error", { "maxNumericValue": 102400 }]`) is
  in **bytes**. Copy a number across without converting and the budget is off by
  1024x - silently passing (or failing) everything. Keep units straight per file.
- **Perf runs flake; sample more than once.** A single Lighthouse run varies run
  to run (CPU contention, network jitter). Set `numberOfRuns` (LHCI default 3)
  and let it take the **median**; treat a one-shot LCP/CLS number as noise, not a
  gate. This is why the deterministic Tier 0/1 structural checks are the gate and
  Lighthouse is corroboration.
- **unlighthouse is site-wide; LHCI is per-URL.** unlighthouse crawls and scores
  every route (good for a whole-site regression sweep, one command); LHCI asserts
  against specific URLs you list (good for gating known critical routes with a
  budget). Reach for unlighthouse to *find* the regressed page, LHCI to *gate*
  it. Both need a served preview + Chrome, so neither is as cheap as Tier 0.
- <https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md> ·
  <https://unlighthouse.dev/>

## 6. DevTools Performance panel

1. **Live Metrics (no trace).** Opening the Performance panel reads local
   LCP/CLS/INP live via web-vitals - interact with the page to surface INP and
   interaction-driven CLS. Enable **Field data** (opt-in; sends the URL to the
   CrUX API) to read real-user p75 beside the local numbers - the field p75 is
   the verdict (section 4). The panel can also recommend a throttling preset
   derived from your users' p75 RTT; use that for a *field-representative* read,
   but keep section 4a's slowest preset when the goal is reliably reproducing
   FOUT/pop-in (a worst case, not a field average).
2. **Record a trace** only when you need per-shift detail. Set Network ->
   **Disable cache** + throttling -> **3G** first, then read the **Layout
   Shifts** track (purple diamonds grouped into session-window clusters; click
   one for the animated shift + Summary tab with score/elements/culprits). The
   Insights sidebar "Layout shift culprits" names causes like "Font request" /
   "Unsized images". (Diamond size is not documented to scale with shift
   magnitude - don't read it that way.)
3. **PSI** shows CrUX field data (the assessment verdict) above a Lighthouse lab
   run; its lab half corroborates but iterates slower (sample the median,
   section 5).

- <https://developer.chrome.com/docs/devtools/performance/reference>

## 7. Wire it into the build where it matters

Where a repo already gates commits (lint, typecheck, tests on pre-commit), a
loading invariant can become a check too. For a **static build** this is nearly
free - a `check-dist.mjs` step (Tier 0) reads the shipped HTML with no server, so
it slots straight into CI after `build`. For an **SSR** repo the equivalent
preload-count gate (section 3a) needs a booted server, so it makes for a slower
commit - like a browser-based a11y smoke. Either way, prefer a mechanical gate
over "remember to check" for anything load-bearing.

## 8. Regression-guard the trade-offs

Eager-loading spends bandwidth; preloading many files competes for it; `fetchpriority`
is zero-sum. After a fix, re-check the vital you might have *regressed* (LCP after
making an image eager or priority-high; overall load after adding preloads), not just
the one you targeted - the 4b/4c probes are the tools for that re-check.
