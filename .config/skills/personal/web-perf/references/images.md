# Image loading & decode timing (native <img>)

## Rules

- **Eager-load above-the-fold decorative images.** `loading="eager"` starts the
  fetch immediately instead of the deferred lazy one-by-one decode - **this** is the
  anti-pop lever. Keep below-the-fold images lazy (the default).
- **`decoding` does NOT sync decode to first paint.** It is only a hint about
  whether to wait for the image to decode before presenting *other* content. Per the
  HTML spec: `async` = "decode asynchronously to avoid delaying presentation of other
  content" - i.e. it lets the rest of the page paint *without* the image, which can
  still pop in after first paint. `sync` = "decode synchronously for atomic
  presentation" (image + content together, but delays that presentation by the decode
  time). MDN: "Setting decoding won't prevent [an empty image being shown as it
  downloads]." So: `decoding="async"` is correct for decorative art precisely because
  it does NOT hold up text paint - not because it aligns decode with paint. For a true
  LCP hero, `sync` (or omitting `decoding`) can be preferable so paint waits for the
  decoded image. `HTMLImageElement.decode()` is the real swap-without-flash tool for
  dynamically-swapped images.
  - <https://html.spec.whatwg.org/multipage/images.html#decoding-images> ·
    <https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding>
- **`loading="eager"` does NOT raise fetch priority.** Eager images still start at
  Low priority and are only boosted to High at layout when found in-viewport. Only
  `fetchpriority="high"` (or a preload) starts them High immediately. Do not imply
  eager reprioritises the fetch.
- **The decode/animation coupling (the subtle one).** A CSS mount/entrance animation
  fires at element *load*, regardless of whether the image has decoded. So "keep it
  lazy + animate it" desyncs: the fade finishes before the image exists. Eager loading
  is what makes a CSS entrance line up with a real image. (Rejected alternative: a JS
  `onLoad`-driven fade guarantees sync but adds state to a pure decorative component
  and risks invisible images with no-JS or a cache-hit-before-hydration race - fails
  the degradation lens.)
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

Images default to **Low** priority and are boosted at layout if in-viewport.
`fetchpriority="high"` = High immediately. A preload = discovery-only at *default*
priority, so image preloads also need `fetchpriority="high"`. They are complementary:
preload fixes *discovery*, fetchpriority fixes *priority*.

- Rule: an `<img>` already in the SSR HTML -> `fetchpriority="high"` on the img usually
  suffices; preload only when discovery is late (CSS background, JS-inserted).
- **Decorative-vs-LCP split:** do NOT add `fetchpriority="high"` to decorative art - it
  would steal priority from the true LCP element. Reserve it for the real LCP element
  (Chrome team: 1-2 per page).
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

- <https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images> ·
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture>

## Placeholders (LQIP) - and when to skip them

Graded cheapest -> priciest: **dominant-colour** (single `background-color`, no
request/decode) < **inline base64** (a few hundred bytes, bloats HTML, real decode) <
**BlurHash** (20-30 char string, needs JS + per-image decode). **NOT worth it for small
decorative art** (icons, dividers, small motifs): the placeholder bytes + decode (+ JS) exceed just
fetching the small final asset eagerly, and BlurHash needs JS so it fails the no-JS /
cache-hit-before-hydration degradation lens (the same reason to reject a JS onLoad
fade). LQIP pays off only for large hero photos; dominant-colour is the cheapest win
there.

- <https://github.com/woltapp/blurhash>

## content-visibility (off-screen only)

`content-visibility:auto` skips off-screen render + decode (web.dev measured ~7x:
232ms -> 30ms). MUST pair with `contain-intrinsic-size` (e.g. `auto 500px`) or the
scrollbar jumps (adds CLS). Applies to OFF-screen content only - no help for
first-viewport images (use eager + priority, or inline SVG, there). Do not put it on
above-the-fold containers.

- <https://web.dev/articles/content-visibility> ·
  <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>
