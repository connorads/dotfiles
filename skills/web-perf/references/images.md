# Image loading & decode timing

Hand-wired `<img>` (no framework image component). The rules are the
browser's, so they hold on any stack - static, SPA, or SSR.

**Triage gate**: if the page has no hero/LCP image at all (text LCP, only
small icons/decorative art), most of this file is N/A - check just the
eager/lazy split and box reservation, and route the LCP work to fonts
(symptoms.md C3).

## Rules

- **Never lazy-load above-the-fold / LCP images.** That is the anti-pop lever.
  On native `<img>`, **eager is the HTML default** - adding `loading="eager"`
  only changes behaviour where something set the image lazy: a CMS, a lazy-load
  lib, or a framework component (astro:assets `<Image>` defaults to
  `loading="lazy" decoding="async"`). A lazy above-the-fold image defers its
  fetch until layout proves it in-viewport, so images pop in one by one. Give
  below-the-fold images an explicit `loading="lazy"` - lazy is opt-in, not free
  by default.
- **`decoding` does NOT sync decode to first paint.** It is only a hint about
  whether to wait for the image to decode before presenting *other* content. Per the
  HTML spec: `async` = "decode asynchronously to avoid delaying presentation of other
  content" - i.e. it lets the rest of the page paint *without* the image, which can
  still pop in after first paint. `sync` = "decode synchronously for atomic
  presentation" (image + content together, but delays that presentation by the decode
  time). MDN: "Setting decoding won't prevent [an empty image being shown as it
  downloads]." So: `decoding="async"` is correct for decorative art precisely because
  it does NOT hold up text paint - not because it aligns decode with paint. Nor is
  `decoding` an LCP lever in either direction: it shapes post-fetch presentation, not
  the network path, and WordPress-core benchmarking found `decoding="async"` on the
  LCP image harmless (their LCP images ship `fetchpriority="high"` +
  `decoding="async"` together). Fix LCP with discovery + priority; never sell a
  `decoding` flip as the fix. `HTMLImageElement.decode()` is the real
  swap-without-flash tool for dynamically-swapped images.
  - <https://html.spec.whatwg.org/multipage/images.html#decoding-images> ·
    <https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding>
- **`loading="eager"` does NOT raise fetch priority.** Eager only starts the
  fetch early; it does not change the image's priority (still Low, boosted to
  High at layout when found in-viewport - the priority model is in Priority &
  discovery below). Only `fetchpriority="high"` (or a preload) starts it High
  immediately. Do not imply eager reprioritises the fetch.
- **The decode/animation coupling (the subtle one).** A CSS mount/entrance animation
  fires at element *load*, regardless of whether the image has decoded. So "keep it
  lazy + animate it" desyncs: the fade finishes before the image exists. Eager loading
  is what makes a CSS entrance line up with a real image. (Rejected alternative: a JS
  `onLoad`-driven fade guarantees sync but adds state to a pure decorative component
  and risks invisible images with no-JS or a cache-hit-before-hydration race - fails
  the degradation lens.) **Corollary for the LCP element**: never reveal it
  from `opacity: 0` - opacity-0 content is excluded from LCP as
  non-contentful, so a JS-gated fade delays the recorded LCP until the reveal
  even after eager/decode is fixed (symptoms.md B7). Transform-only entrances
  leave the paint alone.
- **Reserve the box to avoid CLS.** Width/height *attributes* alone now make browsers
  (Chrome/FF/Safari, since 2021) infer `aspect-ratio: auto W/H` and reserve space
  before load, even when CSS sets `width:100%; height:auto` - no explicit CSS
  `aspect-ratio` needed. `auto` lets the real dimensions override after download.
  Rotation is a transform, so reserve the *un-rotated* box (a tall portrait rotated
  90deg still reserves its narrow upright box, not the wide rotated footprint).
- **`position:absolute` decorative images cause no CLS by construction** (out of flow)
  - so their only first-load defect is the decode pop, not a shift.
- Entrance design itself (ease-out, `scale(0.96)` not `scale(0)`, stagger,
  reduced-motion) belongs to `web-animation-design` - cross-reference, do not restate.
- <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img> ·
  <https://web.dev/articles/optimize-cls>

## Priority & discovery

Images default to **Low** priority (since Chrome 117, the first few large
in-viewport images start at Medium) and are boosted at layout if in-viewport.
`fetchpriority="high"` = High immediately. A preload = discovery-only at *default*
priority, so image preloads also need `fetchpriority="high"`. They are complementary:
preload fixes *discovery*, fetchpriority fixes *priority*.

- Rule: an `<img>` already in the SSR HTML -> `fetchpriority="high"` on the img usually
  suffices; preload only when discovery is late (CSS background, JS-inserted).
- **CSS `background-image` LCP candidate -> prefer the structural fix.** Move it
  into an `<img>` (`object-fit: cover` + `object-position` for the crop) so the
  preload scanner discovers it in markup; fall back to preloading the background
  (`as=image` + `fetchpriority="high"`) only when it can't be dropped (art
  direction, gradient overlay). A JS-inserted LCP image stays preload-first -
  there is no markup for the scanner to find.
- **Decorative-vs-LCP split:** do NOT add `fetchpriority="high"` to decorative art - it
  would steal priority from the true LCP element. Reserve it for the real LCP element
  (Chrome team: 1-2 per page).
- **Demote competing above-the-fold images**, don't just avoid boosting them:
  `fetchpriority="low"` on a header logo/avatar, a secondary hero, or offscreen
  carousel slides frees bandwidth for the LCP fetch - *not* boosting the LCP is
  not the same as demoting its rivals. For near-viewport carousel/offscreen
  slides pair `loading="lazy"` WITH `fetchpriority="low"`: Chrome may judge
  slides 2-4 "close enough" to in-viewport and eager-fetch/boost them despite
  `lazy`, so lazy alone doesn't stop the contention.
- Responsive preloads (`imagesrcset`/`imagesizes`) do NOT work in HTTP-header preload or
  103 Early Hints.

```html
<link rel="preload" as="image"
      imagesrcset="wolf_400.jpg 400w, wolf_800.jpg 800w, wolf_1600.jpg 1600w"
      imagesizes="50vw" fetchpriority="high">
<img src="wolf_800.jpg" srcset="wolf_400.jpg 400w, wolf_800.jpg 800w, wolf_1600.jpg 1600w"
     sizes="50vw" fetchpriority="high">
```

- <https://web.dev/articles/fetch-priority> · <https://addyosmani.com/blog/fetch-priority/> ·
  <https://web.dev/articles/preload-responsive-images> ·
  <https://developer.mozilla.org/en-US/blog/fix-image-lcp/>

## Responsive & format negotiation (the next/image gap)

```html
<!-- resolution switching -->
<img srcset="img-480.jpg 480w, img-800.jpg 800w"
     sizes="(width <= 600px) 480px, 800px" src="img-800.jpg" alt="...">

<!-- format negotiation: order AVIF > WebP > JPEG -->
<picture>
  <source srcset="photo.avif" type="image/avif">
  <source srcset="photo.webp" type="image/webp">
  <img src="photo.jpg" alt="photo">
</picture>
```

Selection: the first true `sizes` condition picks the matching (or next-larger)
`srcset` candidate, scaled down; a `<source>` whose `type` the UA cannot decode is
SKIPPED, so order matters; the `<img>` is mandatory (it renders and is the fallback);
`srcset`+`sizes` can live on a `<source>` to combine both.

Two newer primitives worth knowing: on a `loading="lazy"` img with a
width-descriptor srcset, `sizes="auto, (width <= 600px) 480px, 800px"` lets the
browser use the *actual layout width* instead of the hand-maintained condition
list (lazy-only by design - eager images pick a candidate before layout; keep
the fallback conditions after `auto` for non-supporting engines). And
`width`/`height` are now honoured on `<picture>` `<source>` elements in all
engines, so art-directed variants with *different* aspect ratios can each
reserve the correct box - without them only the `<img>`'s ratio is reserved and
the art-directed breakpoint shifts.

- <https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images> ·
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture>

### Astro anti-patterns (astro:assets)

- **`<img src={img.src}>` throws the optimisation away.** Importing via
  astro:assets and then rendering a raw `<img>` keeps width/height (no CLS)
  but silently loses srcset generation and AVIF/WebP format negotiation - the
  original file ships to every viewport. Use `<Image>`/`<Picture>` from
  `astro:assets` instead.
- **`<Image>` is lazy by default** (`loading="lazy" decoding="async"`). For
  the one LCP image use the `priority` prop (5.10+): it sets
  `loading="eager"` + `decoding="sync"` + `fetchpriority="high"` in one flag.

## Animated GIFs: convert to video

A multi-MB animated GIF used as hero/LCP media is a byte-weight problem none
of the levers above touch - `decoding`, eager loading and `fetchpriority`
change *when* bytes arrive, not how many. Convert to
`<video autoplay muted loop playsinline poster="first-frame.jpg">` (H.264/WebM
is routinely 10x+ smaller than GIF), or ship a first-frame poster image and
load the animation on interaction. `muted` + `playsinline` are what allow
autoplay on iOS. Reserve the box exactly as for images (width/height or
`aspect-ratio`) - the attribute->aspect-ratio inference works on `<video>`
too. Any raw `<video>` hero also wants a `poster`: LCP for video uses the
poster image or the first presented frame, whichever paints earlier, so a
lightweight poster gives a controlled, early LCP paint instead of waiting on
video bytes.

- <https://web.dev/articles/replace-gifs-with-videos>

## Placeholders (LQIP) - and when to skip them

Graded cheapest -> priciest: **dominant-colour** (single `background-color`, no
request/decode) < **inline base64** (a few hundred bytes, bloats HTML, real decode) <
**BlurHash** (20-30 char string, needs JS + per-image decode). **NOT worth it for small
decorative art** (icons, dividers, small motifs): the placeholder bytes + decode (+ JS) exceed just
fetching the small final asset eagerly, and BlurHash needs JS so it fails the no-JS /
cache-hit-before-hydration degradation lens (the same reason to reject a JS onLoad
fade). LQIP pays off only for large hero photos; dominant-colour is the cheapest win
there.

**A placeholder never improves LCP.** Chrome excludes low-entropy images
(< 0.05 bits per displayed pixel - blurry placeholders, gradients, solid fills)
as LCP candidates precisely so a blur-up cannot game the metric: the real image
still sets the LCP timestamp. LQIP is a perceived-quality lever only - when the
complaint is "LCP is slow", the fix is discovery + priority above, not a
placeholder.

- <https://github.com/woltapp/blurhash> · <https://web.dev/articles/lcp>

## content-visibility (off-screen only)

`content-visibility:auto` skips off-screen render + decode (web.dev measured ~7x:
232ms -> 30ms). MUST pair with `contain-intrinsic-size` (e.g. `auto 500px`) or the
scrollbar jumps (adds CLS). Applies to OFF-screen content only - no help for
first-viewport images (use eager + priority, or inline SVG, there). Do not put it on
above-the-fold containers.

- <https://web.dev/articles/content-visibility> ·
  <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>
