# Mechanical Enforcement — Web delivery gates

Mechanical gates for what a browser actually receives: accessibility, HTML
conformance, structured data, social-share metadata, and links. These are the
*runtime/artifact* sibling of the static spine — most need a build and a rendered
DOM, so they run at CI / pre-push, not pre-commit (html-validate and schema-dts
are the static exceptions). Routed from the picks table and rules-catalogue index
in `SKILL.md`.

- [Runtime accessibility](#runtime-accessibility)
- [HTML conformance](#html-conformance)
- [Structured data (SEO)](#structured-data-seo)
- [Social / Open Graph metadata](#social--open-graph-metadata)
- [Broken links](#broken-links)

Boundaries with neighbouring skills — this skill owns only the **mechanical
gate**:

- **Performance** (Lighthouse perf, size-limit, first-load byte/font invariants)
  → the `web-perf` skill and "Asserting on shipped artifacts" in
  `references/typescript.md`. This file does not re-cover perf.
- **Accessibility rationale and manual testing** (screen-reader linearisation,
  keyboard walkthroughs) → the `accessibility` skill. This file wires the axe /
  pa11y gate that catches regressions the manual pass would; it does not teach
  the why.
- **Static a11y lint** (`jsx-a11y`) → UI hygiene in `references/typescript.md`.
  The runtime a11y gate below is its deliberate complement, not a duplicate.

## Runtime accessibility

Static `jsx-a11y` reads source and catches missing `alt`, bad roles, and
handler/role mismatches — but three violation classes are invisible until the
page renders, so they need axe against a real DOM (Deque's own guidance is to run
both, not choose):

- **Colour contrast** — needs computed CSS and pixels.
- **Computed ARIA** — dynamic prop values are unknown before runtime.
- **DOM structure / focus order** — landmark relationships, `dlitem`/`definition-list`,
  focus sequence across composed components.

Two gates, chosen by what the repo already has:

| Situation | Gate | Mechanism |
|---|---|---|
| An e2e suite exists (Playwright) | **@axe-core/playwright** | Assertion-driven — a failing `expect` fails the test, and `playwright test` exits non-zero. No CLI flag gates it. |
| No e2e suite; gate a URL list or sitemap | **pa11y-ci** | Reads `.pa11yci`; exits code 2 when errors exceed `threshold` (default 0). Runs its own headless Chrome via Puppeteer. |

```js
// @axe-core/playwright — bundles axe-core (~4.12.x); only peer dep is playwright-core
import AxeBuilder from '@axe-core/playwright'; // default export; { AxeBuilder } also works
const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
expect(results.violations).toEqual([]); // a violation fails the test → non-zero exit
```

```jsonc
// .pa11yci  (JSON in cwd; or --config path)
{
  "defaults": {
    "standard": "WCAG2AA",         // WCAG2A | WCAG2AA (default) | WCAG2AAA (htmlcs runner only)
    "runners": ["axe", "htmlcs"],  // plural array; default ["htmlcs"]
    "threshold": 0                 // errors permitted before exit 2
  },
  "urls": ["https://localhost:3000/", "https://localhost:3000/about"]
}
// Sitemaps are NOT a urls entry — pass on the CLI: `pa11y-ci --sitemap https://…/sitemap.xml`
// (a --sitemap run ignores the urls property entirely).
```

Two weaker tiers, listed so they are not mistaken for the gate:

- **jest-axe** — a lighter jsdom tier (`expect(await axe(container)).toHaveNoViolations()`).
  No contrast (no real layout), and in inactive maintenance (10.0.0, Mar 2025) —
  still works. Use only when a real browser is unavailable.
- **Lighthouse's accessibility category** — a coarse axe *subset* scored 0–1;
  a 0.95 threshold hides discrete violations axe/pa11y fail on individually.
  Never the primary a11y gate. Lighthouse belongs to perf/SEO (`web-perf` skill).

## HTML conformance

**html-validate** is a static, offline HTML5 validator/linter — no DOM, no
network — so it lints SSR output, built `dist/*.html`, or component templates and
exits non-zero on any `error`-severity problem. It is the cheapest, most
deterministic web gate, closest to the static spine.

```js
// .htmlvalidate.js (or html-validate.config.js flat config)
import { defineConfig } from "html-validate"; // defineConfig is optional (IDE hints only)
export default defineConfig({
  extends: ["html-validate:standard"],
  rules: { "element-required-attributes": "error", "no-raw-characters": "error" },
});
```

Gate: `html-validate "**/*.html"` (quote the glob so html-validate expands it).
Add `--max-warnings 0` to also fail on warnings.

- **It does not enforce `<html lang>`.** `html-has-lang` / `valid-lang` are
  *axe* rule ids, not html-validate rules — configuring them fails html-validate's
  schema validation. Lang enforcement belongs to the runtime a11y gate above.
- **Aggressive Node floor**: `engines` is `^22.22.0 || >= 24.8.0`; older Node
  refuses to install.

## Structured data (SEO)

Prefer **correct-by-construction over runtime validation**: **schema-dts**
(Google, Apache-2.0) supplies TypeScript types for schema.org JSON-LD, so
malformed structured data is a compile error. It is types-only — no CLI of its
own; the gate is your existing `tsc --noEmit` step (this is parse-don't-validate
applied to structured data — see the `typescript` skill).

```ts
import type { WithContext, Product } from "schema-dts";
const data: WithContext<Product> = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Widget",
  offers: { "@type": "Offer", price: "9.99", priceCurrency: "USD" },
}; // a misspelled property or wrong @type fails `tsc --noEmit`
// schema-dts-gen (sibling CLI) generates types for a pinned schema.org version.
```

schema-dts checks *shape* against the vocabulary, not Google's Rich-Results
*requirements* (which field is required for a rich snippet). The hosted
validators (validator.schema.org, Rich Results Test) cover that but have no CI
API — reference-only, not gates. Lighthouse's SEO category is a reasonable coarse
crawlability/meta score, and lives with Lighthouse in the `web-perf` skill.

## Social / Open Graph metadata

No mature OSS CI gate exists for Open Graph / Twitter-card correctness — X's
validator was retired in 2022 and structured-data-testing-tool is abandoned
(~2020). Gate it with a thin DIY check: parse the delivered HTML with
**open-graph-scraper** (a maintained parser, v6, ESM, Node ≥20 — *not* itself a
gate) and assert the required tags, exiting non-zero on a miss.

```js
import ogs from 'open-graph-scraper';
import { readFile } from 'node:fs/promises';
const html = await readFile('dist/index.html', 'utf8'); // built HTML → no network in CI
const { result } = await ogs({ html });
const missing = ['ogTitle', 'ogDescription', 'ogImage', 'twitterCard'].filter((k) => !result[k]);
if (missing.length) { console.error('Missing OG/Twitter tags:', missing.join(', ')); process.exit(1); }
```

Honest scope: this gates *markup presence and well-formedness only* — it cannot
tell you the preview image or copy is any good. An SPA must SSR/prerender these
tags for the check (and for the crawlers) to see them at all.

## Broken links

**lychee** (Rust) checks links in Markdown/HTML/text and, via the action,
`fail: true` (default) exits non-zero on any dead link; the CLI exits 2 directly.
Broken links are an SEO-and-UX regression class worth gating on docs and
generated sites.

```yaml
- uses: lycheeverse/lychee-action@v2   # pin to a SHA (or Dependabot the tag)
  with:
    args: --cache --max-cache-age 1d .
    fail: true                         # default; job fails on broken links
```

It hits live URLs, so runs are network-flaky/rate-limited — use `--cache`, a
`.lycheeignore`, and for noisy repos a scheduled run with `fail: false` +
issue-creation instead of a hard PR gate. linkinator is the Node-native
alternative (weaker: fragment checks only on server-rendered HTML).
