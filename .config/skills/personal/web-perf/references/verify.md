# Verify a loading fix (cold cache)

The lens no other loading skill carries. A perf fix you did not observe is a
guess. Every fix in this skill has a matching check here; scale the check to the
stakes (a preload count is a curl; a CLS claim wants a probe).

## Contents

- [1. First: which artifact are you asserting on?](#1-first-which-artifact-are-you-asserting-on)
- [2. Tier 0 - static / prerender: assert on the built HTML directly](#2-tier-0---static--prerender-assert-on-the-built-html-directly)
- [3. Tier 1 - SSR / per-request: boot the route, assert on rendered bytes](#3-tier-1---ssr--per-request-boot-the-route-assert-on-rendered-bytes)
- [4. Shared probes (either tier): cold-cache by eye + CLS](#4-shared-probes-either-tier-cold-cache-by-eye--cls)
- [5. Measurement-tool gotchas (Lighthouse CI / unlighthouse)](#5-measurement-tool-gotchas-lighthouse-ci--unlighthouse)
- [6. DevTools trace workflow](#6-devtools-trace-workflow)
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

Both tiers share the by-eye cold-cache pass and the CLS probe (section 4) -
those drive a real browser and don't care how the HTML was produced (for a
static site, serve `dist` with any static server to give the browser a URL).

## 2. Tier 0 - static / prerender: assert on the built HTML directly

When the build emits the final HTML, the shipped bytes are sitting on disk.
Skip the server and Playwright entirely - read `dist/*.html` in a Node script
and fail non-zero. This is the cheapest, most deterministic tier, and every
byte-level structural invariant belongs here:

- **font preload count within budget** - fonts are Highest priority, so an extra
  preload steals bandwidth from the critical path (budget ~2-3; resource-hints.md).
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
that file for the `@font-face` cross-check instead of the HTML).

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

### 3a. Count what shipped in the head (cheapest, do this first)

Playwright locator (single count assertion) - set the count to the exact number
of above-the-fold weights your head preloads:

```ts
// React/framework may hoist <link> into <head>, so target rendered DOM, not JSX
await expect(page.locator('head link[rel="preload"][as="font"]')).toHaveCount(N);
```

Node variant (order-tolerant) for a preload-count gate against a booted route.
Point `URL` at whatever route/port your dev server boots, and set `EXPECT` to
your count:

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="http://localhost:$PORT/"; EXPECT=N
curl -fsS "$URL" | node -e '
  const h = require("fs").readFileSync(0,"utf8");
  const links = h.match(/<link\b[^>]*>/gi) ?? [];
  const font = links.filter(l => /rel="?preload"?/i.test(l) && /as="?font"?/i.test(l));
  const want = Number(process.argv[1]);
  console.log("font preloads:", font.length);
  for (const l of font) console.log("  " + (l.match(/href="([^"]+)"/)?.[1] ?? l));
  if (font.length !== want) { console.error(`FAIL: expected ${want}`); process.exit(1); }
' "$EXPECT"
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

## 4. Shared probes (either tier): cold-cache by eye + CLS

### 4a. See it cold-cache, by eye

Incognito, or DevTools -> Network -> **Disable cache** + throttle to **Slow 3G**
(the Disable-cache checkbox and the throttling dropdown sit together in the
Network action bar; recent Chrome also lists Slow/Fast 4G + custom profiles
under Settings > Throttling). This is the only way FOUT/pop-in reliably
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
short timeout catches font-swap/decode shifts. Lighthouse / PSI and WebPageTest filmstrip
corroborate but iterate slower.

- <https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditions> ·
  <https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift> ·
  <https://playwright.dev/docs/api/class-page#page-add-init-script>

## 5. Measurement-tool gotchas (Lighthouse CI / unlighthouse)

When you reach for a runtime tool to corroborate a fix, three traps waste the
most time:

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

## 6. DevTools trace workflow

1. **Network** panel: tick **Disable cache** + throttling -> **Slow 3G**.
2. **Performance** panel: record a trace, read the **Layout Shifts** track (purple
   diamonds grouped into session-window clusters; click one for the animated shift +
   Summary tab with score/elements/culprits). The Insights sidebar "Layout shift
   culprits" names causes like "Font request" / "Unsized images". (Diamond size is not
   documented to scale with shift magnitude - don't read it that way.)
3. **Lighthouse / PSI** corroborate CLS/LCP but iterate slower (sample the median,
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
the one you targeted.
