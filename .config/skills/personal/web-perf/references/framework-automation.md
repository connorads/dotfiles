# Framework automation <-> the hand-rolled equivalent

The boundary that decides whether this skill even applies. Where a framework's
font/image layer does the left column for you, defer to it; this skill is the
right column - the hand-rolled version, for the parts no framework layer covers.
It is **not all-or-nothing**: a stack can automate images but leave fonts to you,
so check per-concern, not per-framework.

**Automation is a spectrum, not a Next/not-Next switch:**

- **Next** - automates almost the whole table (`next/font` + `next/image`). If
  the project is on Next, defer entirely to `next-best-practices/{font,image}.md`
  and stop.
- **Astro** - *partial*. Ships a built-in `<Image>`/`<Picture>` (sizing,
  format negotiation, lazy) so the image rows are handled - but fonts are still
  your `@font-face` (Astro's experimental fonts API aside), so the font rows are
  **this skill**. Mixed: use the framework's image component, hand-roll the fonts.
- **Vite SPA/MPA, plain SSR, static hand-built HTML** - no font/image layer;
  the whole right column is yours.

Read the left column as "what *a* framework layer automates" (Next is the
fullest example); the right column is what you write by hand when it doesn't.

| What you need | A framework layer may automate | Hand-rolled equivalent (this skill) |
| --- | --- | --- |
| Self-host Google/local fonts | Next `next/font/google` / `next/font/local` | `@fontsource` (or raw `@font-face`) + bundler asset handling (Vite `?url`) |
| Zero-CLS font swap | Next `adjustFontFallback` (Capsize-derived: `sizeAdjust` = avg-width ratio, then ascent/descent/lineGap overrides /(unitsPerEm*sizeAdjust)) | hand-authored `@font-face` with `size-adjust`/`ascent-override`/`descent-override`, generated via Fontaine/Capsize (fonts.md) |
| Preload the right font | Next: automatic for the used subset/weights | explicit `?url` import + `<link rel=preload as=font crossorigin>` per weight, below the stylesheet (resource-hints.md) |
| Only load needed characters | Next `subsets: ['latin']` | `@fontsource` subset imports / `unicode-range` / re-subset with a coverage guard (fonts.md) |
| Above-the-fold image priority | Next `<Image priority>`; Astro `<Image>` | `fetchpriority="high"` on the true LCP `<img>` (eager alone does not reprioritise); decorative art stays eager without high priority (images.md) |
| Below-fold lazy | Next/Astro `<Image>` default lazy | `loading="lazy"` (default) |
| No-CLS image box | Next width/height/fill required; Astro infers from source | width/height attributes infer `aspect-ratio` and reserve the box; reserve the *un-rotated* box for transforms (images.md) |
| Placeholder | Next `placeholder="blur"` + blurDataURL | hand-rolled dominant-colour/LQIP, or skip for small art (images.md) |
| Responsive sources + format | Next `sizes` + auto srcset; Astro `<Picture>` | manual `srcset`/`sizes` + `<picture><source type>` for AVIF/WebP (images.md) |

**Rule**: per concern, if a framework layer automates the row, defer to it and
stop; where it doesn't, this skill's job is to make the manual version as
mechanical and verifiable as the framework version. Fully-automated stack (Next)
-> close this skill; partial (Astro: images automated, fonts not) -> use it for
the un-automated concern only.

- <https://github.com/vercel/next.js/blob/canary/packages/next/src/server/font-utils.ts> ·
  <https://docs.astro.build/en/guides/images/>
