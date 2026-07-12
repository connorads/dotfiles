# Framework automation <-> the hand-rolled equivalent

The boundary that decides whether this skill even applies. Where a framework's
font/image layer does the left column for you, defer to it; this skill is the
right column - the hand-rolled version, for the parts no framework layer covers.
It is **not all-or-nothing**: a stack can automate images but leave fonts to you,
so check per-concern, not per-framework.

**Automation is a spectrum, not a Next/not-Next switch:**

- **Next** - automates almost the whole table (`next/font` + `next/image`);
  defer to that layer's own output. But still inspect app code *wrapping* it:
  an opacity-0 `onLoad` fade wrapper around a `priority` hero (invisible with
  no-JS, racy on warm cache, defeats `fetchpriority`), or a raw `font-family`
  re-declaration in global CSS that silently drops the `next/font` metric
  fallback, reintroduces the exact jank this skill owns. Two footguns inside
  the automated layer itself: `adjustFontFallback` computes the metric
  fallback once per family (from the first font file), not per weight - a
  heavier heading weight added later can still swap with a metric mismatch
  (prefer one variable font, or verify the fallback against every rendered
  weight); and a `weight: ['400','500','600','700']` array whose pages render
  only 400 ships wasted font preloads - trim the array to rendered weights
  (the preload budget, resource-hints.md). The auto fallback is also
  Arial/Times-derived, a poor metric match for pixel/display faces - check
  the residual shimmer on those.
- **Astro** - *version-dependent*. Ships a built-in `<Image>`/`<Picture>`
  (sizing, format negotiation, lazy **by default** - put the `priority` prop on
  the one LCP image), so the image rows are handled. Fonts: where the built-in
  **Fonts API is active** - stable in Astro 6, behind the `experimental.fonts`
  flag in 5.7+ - it automates self-hosting, opt-in `<Font preload />`,
  `optimizedFallbacks` metric fallbacks, and provider-level subsetting
  (`subsets`/`unicodeRange`) - defer to it for those rows (fonts.md lead note).
  Custom fixed-copy re-subsetting + the coverage guard stay hand-rolled even
  then. Without the Fonts API active (below 5.7, or 5.7+ with the flag off), all
  font rows are this skill.
- **Vite SPA/MPA, plain SSR, static hand-built HTML** - no font/image layer;
  the whole right column is yours.

Two adjacent boundaries that look like automation but aren't:

- **Tailwind v4 `@theme` `--font-*` tokens register utilities only** - they
  never load a font file. A `--font-display: "Fraunces", serif` token with no
  `@font-face`/font import behind it silently renders the fallback forever
  (symptoms.md, the gate before B).
- **Astro islands: the `client:*` directive is the hydration-timing control.**
  `client:load` vs `client:idle` vs `client:visible` decides *when* an island
  hydrates and can flip/pop - pick per island rather than reaching for the
  generic hydration-flip fixes first.

Read the left column as "what *a* framework layer automates" (Next is the
fullest example); the right column is what you write by hand when it doesn't.

| What you need | A framework layer may automate | Hand-rolled equivalent (this skill) |
| --- | --- | --- |
| Self-host Google/local fonts | Next `next/font/google` / `next/font/local`; Astro 6 Fonts API (`fonts` config) | `@fontsource` (or raw `@font-face`) + bundler asset handling (Vite `?url`) |
| Zero-CLS font swap | Next `adjustFontFallback` (Capsize-derived: `sizeAdjust` = avg-width ratio, then ascent/descent/lineGap overrides /(unitsPerEm*sizeAdjust)); Astro 6 `optimizedFallbacks` | hand-authored `@font-face` with `size-adjust`/`ascent-override`/`descent-override`, generated via Fontaine/Capsize (fonts.md) |
| Preload the right font | Next: automatic for the used subset/weights; Astro 6 `<Font preload />` (opt-in) | explicit `?url` import + `<link rel=preload as=font crossorigin>` per weight, below the stylesheet (resource-hints.md) |
| Only load needed characters | Next `subsets: ['latin']`; Astro 6 `subsets` + `unicodeRange` | `@fontsource` subset imports / `unicode-range`; custom fixed-copy re-subset with a coverage guard stays hand-rolled everywhere (fonts.md) |
| Above-the-fold image priority | Next `<Image priority>`; Astro `<Image priority>` (5.10+: sets `loading="eager"` + `decoding="sync"` + `fetchpriority="high"`; the component is lazy by default without it) | `fetchpriority="high"` on the true LCP `<img>` (eager alone does not reprioritise); decorative art stays eager without high priority (images.md) |
| Below-fold lazy | Next/Astro `<Image>` default lazy | explicit `loading="lazy"` (opt-in - native `<img>` is eager by default) |
| No-CLS image box | Next width/height/fill required; Astro infers from source | width/height attributes infer `aspect-ratio` and reserve the box; reserve the *un-rotated* box for transforms (images.md) |
| Placeholder | Next `placeholder="blur"` + blurDataURL | hand-rolled dominant-colour/LQIP, or skip for small art (images.md) |
| Responsive sources + format | Next `sizes` + auto srcset; Astro `<Picture>` | manual `srcset`/`sizes` + `<picture><source type>` for AVIF/WebP (images.md) |

**Rule**: per concern, if a framework layer automates the row, defer to it and
stop; where it doesn't, this skill's job is to make the manual version as
mechanical and verifiable as the framework version. "Defer and stop" applies to
the framework layer's **own output** - app code wrapping it (fade wrappers,
CSS hiding a `priority` image, raw `font-family` overrides) is still in scope.
Fully-automated stack (Next) -> close this skill once the wrapping code is
clean; partial (Astro without the Fonts API active: images automated, fonts
not) -> use it for the un-automated concern only.

- <https://github.com/vercel/next.js/blob/canary/packages/next/src/server/font-utils.ts> ·
  <https://docs.astro.build/en/guides/images/>
