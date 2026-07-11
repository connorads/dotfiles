# Verify a loading fix (cold cache)

The lens no other loading skill carries. A perf fix you did not observe is a guess.
Every fix in this skill has a matching check here; scale the check to the stakes (a
preload count is a curl; a CLS claim wants a probe).

## 1. Count what shipped in the SSR head (cheapest, do this first)

Boot the app, fetch the rendered HTML for the *actual route*, and assert on it - do
not trust the source, trust the bytes. The head is framework-rendered per request
(e.g. TanStack Start renders it server-side via `HeadContent`/`head()`; React 19 may
also hoist `<link>` into `<head>`), so there is no static `dist/index.html` to grep -
target the rendered DOM/SSR bytes.

Playwright locator (single count assertion) - set the count to the exact number of
above-the-fold weights your head preloads:

```ts
// React/framework may hoist <link> into <head>, so target rendered DOM, not JSX
await expect(page.locator('head link[rel="preload"][as="font"]')).toHaveCount(N);
```

Node variant (order-tolerant) for a preload-count gate against a booted route. Point
`URL` at whatever route/port your dev server boots, and set `EXPECT` to your count:

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
  server your test suite already boots), NOT a static build dir.

## 2. Confirm no double-fetch (exact-file matching)

The preload `href` must be the *same fingerprinted file* the `@font-face src`
requests. Cross-check the preload hrefs against the built font CSS `url()`s; in
DevTools Network a mismatch shows the same face fetched twice, and Chrome logs the
credentials-mode warning ~3s after load (fonts.md).

## 3. See it cold-cache, by eye

Incognito, or DevTools -> Network -> **Disable cache** + throttle to **Slow 3G** (the
Disable-cache checkbox and the throttling dropdown sit together in the Network action
bar; recent Chrome also lists Slow/Fast 4G + custom profiles under Settings >
Throttling). This is the only way FOUT/pop-in reliably reproduces - warm cache hides
it. Toggle OS "Reduce motion" to confirm reduced-motion paths.

## 4. Prove CLS / layout-shift claims (runnable Playwright probe)

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

## 5. DevTools trace workflow

1. **Network** panel: tick **Disable cache** + throttling -> **Slow 3G**.
2. **Performance** panel: record a trace, read the **Layout Shifts** track (purple
   diamonds grouped into session-window clusters; click one for the animated shift +
   Summary tab with score/elements/culprits). The Insights sidebar "Layout shift
   culprits" names causes like "Font request" / "Unsized images". (Diamond size is not
   documented to scale with shift magnitude - don't read it that way.)
3. **Lighthouse / PSI** corroborate CLS/LCP but iterate slower.

- <https://developer.chrome.com/docs/devtools/performance/reference>

## 6. Wire it into the build where it matters

Where a repo already gates commits (lint, typecheck, tests on pre-commit), a loading
invariant can become a check too - e.g. a preload-count step (section 1) asserting the
booted head contains the expected number of font preloads. Prefer a mechanical gate
over "remember to check" for anything load-bearing. Note the cost: like a browser-based
a11y smoke, it needs a booted server, so it makes for a slower commit.

## 7. Regression-guard the trade-offs

Eager-loading spends bandwidth; preloading many files competes for it; `fetchpriority`
is zero-sum. After a fix, re-check the vital you might have *regressed* (LCP after
making an image eager or priority-high; overall load after adding preloads), not just
the one you targeted.
