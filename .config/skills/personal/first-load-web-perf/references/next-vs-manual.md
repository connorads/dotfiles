# next/font & next/image <-> the hand-rolled equivalent

The boundary that stops this skill contradicting `next-best-practices`. On Next, the
framework does the left column for you; this skill is the right column, for stacks that
have no such framework layer.

| What you need | Next does automatically | Hand-rolled equivalent (this skill) |
| --- | --- | --- |
| Self-host Google/local fonts | `next/font/google`, `next/font/local` | fontsource (or raw `@font-face`) + Vite asset handling |
| Zero-CLS font swap | `adjustFontFallback` generates a metric-matched fallback (Capsize-derived: `sizeAdjust` = avg-width ratio, then ascent/descent/lineGap overrides /(unitsPerEm*sizeAdjust)) | hand-authored `@font-face` with `size-adjust`/`ascent-override`/`descent-override`, generated via Fontaine/Capsize (fonts.md) |
| Preload the right font | automatic for the used subset/weights | explicit `?url` import + `<link rel=preload as=font crossorigin>` per weight, below the stylesheet (resource-hints.md) |
| Only load needed characters | `subsets: ['latin']` | fontsource subset imports / `unicode-range` |
| Above-the-fold image priority | `<Image priority>` | `fetchpriority="high"` on the true LCP `<img>` (eager alone does not reprioritise); decorative art stays eager without high priority (images.md) |
| Below-fold lazy | `<Image>` default lazy | `loading="lazy"` (default) |
| No-CLS image box | width/height/fill required | width/height attributes infer `aspect-ratio` and reserve the box; reserve the *un-rotated* box for transforms (images.md) |
| Placeholder | `placeholder="blur"` + blurDataURL | hand-rolled dominant-colour/LQIP, or skip for small art (images.md) |
| Responsive sources | `sizes` + automatic srcset/format | manual `srcset`/`sizes` + `<picture><source type>` for AVIF/WebP (images.md) |

**Rule**: if the project is on Next, close this skill and use
`next-best-practices/{font,image}.md`. This skill is for when there is no framework doing
the above - and its job is to make the manual version as mechanical and verifiable as the
framework version.

- <https://github.com/vercel/next.js/blob/canary/packages/next/src/server/font-utils.ts>
