# Symptoms -> cause -> fix (the spine)

Diagnose from what the user *sees*. Each leaf: the symptom in plain words, the
cause, the fix, the Web Vital it moves, and how to confirm it was that cause.

## Root question

**Does layout MOVE, does only APPEARANCE change, or does NOTHING appear yet?**

```text
Root: Does layout MOVE, only APPEARANCE change, or does NOTHING appear yet?

A. LAYOUT MOVES  (measurable shift -> CLS)
   A1  moves when a webfont loads         = metric-mismatch fallback
   A2  moves when an image/iframe loads   = unreserved box
   A3  moves when late content appears    = injected banner/consent/ad/async
   A4  shifts once at hydration           = initial-HTML vs client size mismatch

B. ONLY APPEARANCE CHANGES  (no measurable shift)
   B1  text INVISIBLE then appears        = FOIT (font-display:block/auto)
   B2  fallback text restyles to webfont  = FOUT shimmer, un-preloaded weight
   B3  section flashes unstyled then snaps = FOUC, late/async/code-split CSS
   B4  icons render as boxes/tofu, swap   = icon-font load
   B5  image pops to opacity 1            = lazy decode
   B6  theme/active state flips at hydrate = initial-HTML/client state mismatch (FART)

C. NOTHING APPEARS YET  (blank-then-paint; timing, not shift/restyle)
   C1  long blank then full paint         = render-blocking CSS/JS or huge hydration bundle
   C2  hero/LCP image arrives very late   = late resource discovery

D. JANK DURING SCROLL/INTERACTION  (not first paint)
   D1  stutter scrolling a long page      = heavy paint/large layers
```

The root split maps onto vitals: **A = CLS**, **C = FCP/LCP**, **B/D =
perceived-quality / INP-adjacent** (no vital unless they also shift).

---

## A. Layout moves (CLS)

### A1. Text reflows / jumps when the webfont loads

- **Cause**: no metric-matched `@font-face` fallback, so the fallback face has
  different metrics (x-height, advance width) and the swap resizes the text box.
- **Fix**: add a local fallback `@font-face` with `size-adjust` +
  `ascent-override` + `descent-override` tuned to the real face; reference it
  first in the stack. Generate the values (Fontaine / Capsize) rather than guess -
  see fonts.md.
- **Vital**: CLS.
- **Confirm**: layout-shift probe drops to ~0 across the swap (verify.md #4);
  before/after screenshots at 0ms and post-swap show no text-box resize.

### A2. Layout jumps as an image (or iframe) loads

- **Cause**: unreserved intrinsic box - the element has no width/height/aspect
  until bytes arrive.
- **Fix**: reserve the box. Width/height *attributes* alone now make browsers
  infer `aspect-ratio: auto W/H` and reserve space, even under CSS
  `width:100%; height:auto` - no explicit CSS `aspect-ratio` needed (images.md).
  Note: CSS rotation is a *transform*, so the reserved layout box is the
  *un-rotated* box - reserve for the upright dimensions. `position:absolute`
  decorative images cause no CLS by construction (out of flow).
- **Vital**: CLS.
- **Confirm**: layout-shift probe ~0; the space is occupied before load in the
  Elements panel.

### A3. Layout jumps when late content appears

- **Cause**: content inserted above/within existing flow *after* first paint - a
  cookie/consent banner, a late-sized ad slot, a notification bar, an async
  skeleton - pushes rendered content down.
- **Fix**: reserve space (min-height / aspect-ratio placeholder or a skeleton of
  the final size), OR render out of flow (`position:fixed/absolute` overlay).
  Never insert content above existing content except in response to a user
  interaction. **The 500ms rule**: shifts within 500ms of a user input carry
  `hadRecentInput` and are excluded from CLS - so a *click*-triggered banner is
  "free", a *load/timer*-triggered one is penalised. For ads/embeds reserve the
  most-likely size.
- **Vital**: CLS.
- **Confirm**: DevTools Layout Shift regions / the probe - the shift fires exactly
  when the banner mounts.
- Ref: <https://web.dev/articles/optimize-cls>

### A4. Layout shifts once at hydration

- The CLS instance of the state mismatch below (B6) - when the initial markup's
  default and the client's real state differ *in size*. Same cause and fixes as B6;
  it just also moves layout. See B6.
- **Needs client JS reconciling state against the initial HTML - not SSR.** A4
  and B6 occur whenever client JS reconciles client-only state against initial
  markup, whether that markup was server-rendered or fixed at build: a fully
  static page whose theme `<script>` reads localStorage flashes identically.
  The static-vs-SSR axis picks the verify tier (static-vs-ssr.md), not whether
  this class can occur - what rules it out is the *absence* of reconciling JS.

---

## B. Only appearance changes (no shift)

### B1. Text is invisible, then appears (FOIT)

- **Cause**: `font-display: block` (or default/`auto`, which behaves block-like)
  holds text invisible for the block period (~3s) waiting for a slow or
  un-preloaded font.
- **Fix**: `font-display: swap` (or `optional` for body text) so the fallback
  paints immediately, AND preload the woff2 so the block period never elapses.
  (B2 assumes `swap` is already in effect - if text is *invisible* rather than
  *restyling*, you are here, not B2.) With hosted Google Fonts, `font-display`
  comes from the css2 URL's `display=` param and defaults to `auto`
  (block-like) - `&display=swap` must be requested; see hosted-fonts.md.
- **Vital**: FCP/LCP (invisible text delays contentful paint); + CLS if the
  fallback is metric-mismatched (A1).
- **Confirm**: cold-cache Slow-3G - text is blank then appears; switching to
  `swap` paints immediately in the fallback face.
- Ref: <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display>,
  <https://web.dev/articles/font-best-practices>

### B2. Faint weight "shimmer" on some text but not the text next to it

- **Cause**: font-swap (FOUT) on an un-preloaded *weight*. With Tailwind,
  `font-medium` = 500 and `font-semibold` = 600 (stable v3->v4); if only 400 is
  preloaded, 500/600 first paint in the fallback face and swap when their woff2
  arrives. The 400 text beside them does not shimmer - that asymmetry is the tell.
  With metric-matched fallbacks in place the swap moves no layout, so it reads
  purely as a shimmer rather than a shift (same fix either way).
- **Fix**: preload the *exact* weights rendered above the fold, per weight (see
  fonts.md). Not "preload the font" - fonts are per-weight files. If the fonts
  come from a hosted CDN (Google Fonts), the woff2 URLs are not reliably
  preloadable - preconnect + `display=` are the levers, or self-host; see
  hosted-fonts.md.
- **Vital**: none directly (no layout move); a perceived-quality defect.
- **Confirm**: DevTools Network, throttle + disable cache; the shimmering run of
  text corresponds to a woff2 that is *not* in the preload list / arrives late.
  Toggling the preload changes the shimmer but never the layout.

### B3. A section flashes unstyled then snaps into place (FOUC)

- **Cause**: content renders before its stylesheet applies - CSS loaded
  non-render-blocking (preload+onload swap, media hack, JS-injected `<style>`), or a
  route/component CSS chunk arriving after its markup. A render-blocking
  `<link rel=stylesheet>` in `<head>` does NOT flash - it blocks first paint (that
  is C1, not B3). A related discovery bug: `@import url(...)` *inside* a
  stylesheet is invisible to the preload scanner and serialises an extra hop
  (fetch + parse the CSS before the import is even requested) - common with
  hosted Google Fonts (hosted-fonts.md).
- **Fix**: keep critical/above-the-fold CSS render-blocking or inlined in `<head>`;
  defer only genuinely non-critical CSS; ensure code-split route CSS is *linked*,
  not lazily injected after mount; replace `@import` chains with parallel
  `<link>` tags (or self-host the fonts).
- **Vital**: none directly (unless a metric-mismatched restyle adds CLS).
- **Confirm**: cold-cache + throttle - the unstyled frame appears before the CSS
  request completes.
- Ref: <https://web.dev/articles/defer-non-critical-css>

### B4. Icons render as boxes/tofu, then swap to real glyphs

- **Cause**: icon fonts map glyphs onto codepoints; during the block/swap period
  (or on a 404) the browser shows the fallback glyph - boxes/tofu or random
  letters - then swaps. Same FOIT/FOUT mechanism, more visible because the fallback
  is meaningless.
- **Fix**: prefer an inline SVG `<symbol>` sprite
  (`<svg><use href="#id"></use></svg>`) - ships as markup, no font resource to fail
  or swap, present at first paint, carries native `<title>`/`<desc>` a11y. If a font
  must stay, preload the woff2 + `font-display: block` (accept brief invisibility
  over a wrong-glyph swap).
- **Vital**: perceived-quality; can nudge LCP if an icon is the LCP element.
- **Confirm**: cold-cache + block the icon-font request in DevTools - font icons
  become tofu; an SVG sprite renders unchanged.
- Ref: <https://css-tricks.com/svg-sprites-use-better-icon-fonts/>

### B5. Image "pops" to full opacity, but nothing shifts

- **Cause**: a `loading="lazy"` `<img>` (often `position:absolute`, so no CLS)
  snaps straight to opacity 1 the instant its bytes decode - a one-by-one pop.
- **Fix (above the fold)**: `loading="eager"` starts the fetch immediately instead
  of the deferred lazy decode - **this** is the anti-pop lever, not `decoding`.
  `decoding="async"` is still right for decorative art, but only because it does
  NOT hold up text paint - it does not sync decode to first paint (images.md). If
  you animate an entrance: a CSS mount animation fires at element *load* regardless
  of decode, so a lazy image would finish fading before it exists - eager is what
  makes the entrance line up with a real image (images.md).
- **Vital**: none (no shift); perceived-quality; can hurt LCP if it *is* the LCP
  element.
- **Confirm**: throttle to Slow-3G; images arrive together instead of popping in
  sequence; layout-shift probe stays ~0.

### B6. A theme / highlighted / active state flips once at hydration (FART)

- **Cause**: the initial HTML and the client's real state disagree. The initial
  markup - server-rendered *or* fixed at build - can't know client-only state
  (localStorage, `prefers-color-scheme`, `navigator.languages`), so it ships a
  default; client JS reads the real value and flips theme/colour/highlight
  once. Reading it in a post-mount effect (React `useEffect` or any
  framework's equivalent) makes it WORSE (guaranteed post-paint flash).
  **Not SSR-only**: a fully static page with a localStorage theme `<script>`
  flashes identically - what the class needs is client JS reconciling state
  against the initial HTML, not a server. Only the *absence* of that
  reconciling JS rules it out (static-vs-ssr.md).
- **Fix**, in order: (1) make the value server-knowable - store the preference in a
  **cookie** so the server renders the correct state (any cookie-based preference -
  theme, locale - has no mismatch); (2) if it must live in localStorage, inject a
  tiny **synchronous** blocking `<script>` in `<head>` that sets the class/attribute
  on `<html>` before paint, add `suppressHydrationWarning` on `<html>` (escape
  hatch, one level deep), and disable CSS transitions during the initial apply to
  avoid a secondary animated flash; (3) gate the reading UI behind a mounted flag /
  render client-only. Not a font/image fix.
- **Vital**: perceived / INP-adjacent; CLS only if the two states differ in size
  (that is A4).
- **Confirm**: cold-cache with a non-default stored theme/locale - correct state in
  the first painted frame (blocking script) or first server frame (cookie); force
  server != client to reproduce the single flip.
- Ref: <https://react.dev/reference/react-dom/components/common> (suppressHydrationWarning),
  <https://github.com/pacocoursey/next-themes#readme> (canonical anti-flash pattern)

---

## C. Nothing appears yet (blank-then-paint)

### C1. Long blank screen, then a full paint (slow FCP)

- **Cause**: nothing paints until the critical path clears - a render-blocking
  CSS/JS in `<head>` without defer/async, or a large client JS/hydration bundle that
  must download+parse+execute. An `@import url(...)` inside a render-blocking
  stylesheet stretches the blank period further: the imported CSS (e.g. a hosted
  Google Fonts URL) is preload-scanner-opaque and only requested after the outer
  CSS is fetched and parsed (hosted-fonts.md).
- **Fix**: ship SSR HTML so first paint does not wait for JS; make scripts
  defer/async (module scripts are deferred by default); inline critical CSS + defer
  the rest; code-split so the initial bundle is small; keep the head lean. This is
  the counterpart to B3: render-blocking = blank screen (C1); deferred = unstyled
  flash (B3).
- **Vital**: FCP (target <=1.8s) + INP (hydration cost). (FCP is a Web Vital but not
  a *Core* Web Vital; TTI is deprecated - use INP for interactivity.)
- **Confirm**: Lighthouse "Eliminate render-blocking resources"; Coverage tab shows
  unused CSS/JS; the cold-cache trace's blank period ends only after the blocking
  resource finishes.
- Ref: <https://web.dev/first-contentful-paint/>,
  <https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources>

### C2. The hero / LCP image arrives very late (slow LCP)

- **Cause**: the preload scanner can only request an image it sees early in raw
  HTML; if the hero is a CSS `background-image`, is JS/client-injected, hides its
  src behind a lazy-load lib, or carries `loading="lazy"`, the bytes are requested
  late.
- **Fix** (web.dev order): NEVER lazy-load the LCP image; put `fetchpriority="high"`
  on a normal discoverable `<img src>` with width/height (not JS-injected); for a
  CSS-background LCP, preload it
  (`<link rel=preload as=image fetchpriority=high type=image/webp>`); remove
  render-blocking CSS/JS.
- **Vital**: LCP.
- **Confirm**: Network cold-cache - the LCP request starts near the waterfall start;
  Lighthouse "LCP image was lazily loaded" / "Preload LCP image" audits clear.
- Ref: <https://web.dev/articles/optimize-lcp>

---

## D. Jank during scroll / interaction

### D1. Stutter when scrolling a long page

- **Cause**: long pages lay out+paint large off-screen content on load and during
  scroll; big/expensive layers jank.
- **Fix**: `content-visibility: auto` on repeated below-the-fold sections skips
  their layout+paint until near the viewport; MUST pair with `contain-intrinsic-size`
  (e.g. `auto 500px`) or the scrollbar jumps and content shifts (adds CLS). Keeps
  content in the DOM/a11y tree and find-in-page working (unlike `display:none`).
  Prefer transform/opacity (composited) animations over layout-triggering ones
  (cross-ref `web-animation-design`).
- **Vital**: not a direct first-paint vital - improves render/main-thread cost
  (helps INP); a wrong intrinsic size ADDS CLS.
- **Confirm**: DevTools Performance - record a scroll; long paint/layout tasks
  shrink; no new layout-shift entries when sections materialise.
- Ref: <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>,
  <https://web.dev/articles/content-visibility>
