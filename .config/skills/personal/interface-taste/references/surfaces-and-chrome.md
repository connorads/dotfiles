# Surfaces, Typography & Chrome Hygiene

Concrete CSS token and base-layer rules that give web and desktop UIs quiet,
tactile, native-grade precision.

## 1. Pure Neutral Chrome + Half-Pixel Physical Lighting

Reserve chromatic color for semantic meaning (focus rings, status, diffs,
active roles). Build chrome from a pure neutral greyscale ramp (`#ffffff` down
to `#080808`) rather than tinted blues/slates, and avoid heavy `backdrop-filter`
glass unless explicitly designing translucent vibrancy.

### Mode-Aware `0.5px` Elevation & Dark Catchlights

In light mode, pair soft ambient shadows with a crisp `0.5px` dark hairline
ring. In dark mode, swap the outer ring to a subtle luminous rim (`alpha-light`)
**plus a `-0.5px` top-edge catchlight** so elevated cards and buttons catch top
light instead of turning into flat grey rectangles:

```css
/* Light mode */
:root, [data-color-scheme="light"] {
  --elevation-raised:
    0px 2px 4px 0px rgba(0, 0, 0, 0.04),
    0px 1px 2px -1px rgba(0, 0, 0, 0.08),
    0px 0px 0px 0.5px rgba(0, 0, 0, 0.12);
  --elevation-floating:
    0px 8px 16px 0px rgba(0, 0, 0, 0.04),
    0px 4px 8px 0px rgba(0, 0, 0, 0.08),
    0px 0px 0px 0.5px rgba(0, 0, 0, 0.12);
  --elevation-button-neutral:
    0px 1px 1.5px 0px rgba(0, 0, 0, 0.10),
    0px 0px 0px 0.5px rgba(0, 0, 0, 0.14);
  --elevation-button-contrast:
    0px 1px 1.5px 0px rgba(0, 0, 0, 0.20),
    0px 0px 0px 0.5px #3a3a3a,
    inset 0px 1px 2px 0px rgba(255, 255, 255, 0.14),
    inset 0px -1px 2px 0px rgba(0, 0, 0, 0.06);
  --elevation-switch-off:
    inset 0px 1px 1px 0px rgba(0, 0, 0, 0.08),
    inset 0px 0.5px 0.5px 0px rgba(0, 0, 0, 0.08),
    inset 0px 0px 0px 0.5px rgba(0, 0, 0, 0.10);
}

/* Dark mode: luminous 0.5px rim + -0.5px top catchlight */
[data-color-scheme="dark"] {
  --elevation-raised:
    0px 2px 4px 0px rgba(0, 0, 0, 0.30),
    0px 1px 2px 0px rgba(0, 0, 0, 0.30),
    0px 0px 0px 0.5px rgba(255, 255, 255, 0.16),
    0px -0.5px 0px 0px rgba(255, 255, 255, 0.06);
  --elevation-floating:
    0px 8px 16px 0px rgba(0, 0, 0, 0.30),
    0px 4px 8px 0px rgba(0, 0, 0, 0.30),
    0px 0px 0px 0.5px rgba(255, 255, 255, 0.16),
    0px -0.5px 0px 0px rgba(255, 255, 255, 0.06);
  --elevation-button-neutral:
    0px 1px 2px 0px rgba(0, 0, 0, 0.40),
    0px 0px 0px 0.5px rgba(255, 255, 255, 0.20),
    0px -0.5px 0px 0px rgba(255, 255, 255, 0.10);
  --elevation-button-contrast:
    0px 1px 2px 0px rgba(0, 0, 0, 0.40),
    0px 0px 0px 0.5px rgba(255, 255, 255, 0.40),
    0px -0.5px 0px 0px rgba(255, 255, 255, 0.30);
  --elevation-switch-off:
    inset 0px -0.5px 0px 0px rgba(255, 255, 255, 0.10),
    inset 0px 0px 0px 0.5px rgba(255, 255, 255, 0.16);
}
```

### Stacked Translucent Overlays & Tactile Button Details

- **Uniform hover/press across every variant**: instead of inventing bespoke
  hover colors for each button variant, stack a translucent hover/pressed
  `linear-gradient` directly over the base fill (`rgba(0,0,0,0.04)` / `0.08` in
  light mode; `rgba(255,255,255,0.06)` / `0.10` in dark mode).
- **Contrast primary buttons**: add a top-down sheen
  (`linear-gradient(180deg, rgba(255,255,255,0.20) 0%, transparent 100%)`) and a
  subtle `text-shadow: 0 0.5px 0.5px rgba(0, 0, 0, 0.3)`.
- **Optical flush alignment (`data-flush`)**: when a borderless ghost button
  sits at the start or end edge of a container, offset it by negative padding
  (`margin-inline-start: calc(-1 * var(--button-inset))`) so its visible label
  aligns cleanly with surrounding text while keeping the generous click target.
- **Native menu feel**: keep `cursor: default` on links/menus/chrome (don't turn
  every app row into a web hand pointer), and keep a parent menu item
  highlighted while the pointer is inside its open submenu
  (`:not(:has([data-highlighted])) [data-expanded]`).

## 2. Variable-Font Micro-Weights & Text-Wrap Hygiene

- **Optical micro-weights**: when using a variable sans font (e.g. Inter), step
  off coarse `400`/`500`/`600` stops - **`440`** for body/menu copy and
  **`530`** for buttons, labels, and headings read noticeably crisper on both
  light and dark HiDPI displays. Pair with tight optical tracking:
  - `15px` titles: `letter-spacing: -0.13px`
  - `13px` UI controls/body: `letter-spacing: -0.04px`
  - `11px` badges/shortcuts/group labels: `letter-spacing: +0.05px`

- **Three-way `text-wrap-style` rule**:

  ```css
  html { text-wrap-style: pretty; }                 /* Prevent single-word orphan last lines */
  code, pre, kbd, samp { text-wrap-style: auto; }   /* Keep greedy editor-like wrapping in code */
  input, textarea, [contenteditable] { text-wrap-style: stable; } /* Never re-wrap earlier lines while typing */
  ```

- **Crisp focus rings**: replace the OS accent focus ring with a single theme
  token (`outline: 2px solid var(--border-focus); outline-offset: 2px`) on
  `:focus-visible` only, adding `border-radius: 4px` to text links.

## 3. Chromium-Safe Floating Hover Scrollbars

Setting `scrollbar-width` or `scrollbar-color` on an element causes Chromium to
**ignore `::-webkit-scrollbar` pseudo-elements completely**. In addition,
Chromium won't repaint `:hover::-webkit-scrollbar-thumb` unless a property on
the hovered element itself changes.

Fix all three gotchas at once:

1. Gate custom scrollbars to fine pointer devices so touch devices keep native
   overlay scrollbars.
2. Register a **non-inherited** `@property --scrollbar-hover` and toggle it on
   `:hover` so Chromium repaints the thumb without restyling the subtree.
3. Put standard `scrollbar-width`/`scrollbar-color` strictly inside
   `@supports not selector(::-webkit-scrollbar)`.

```css
@property --scrollbar-hover {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}

@media (hover: hover) and (pointer: fine) {
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track,
  ::-webkit-scrollbar-corner {
    background-color: transparent;
  }
  ::-webkit-scrollbar-track:vertical { margin: 4px 0; }
  ::-webkit-scrollbar-track:horizontal { margin: 0 4px; }

  /* 4px floating pill inside an 8px hit track */
  ::-webkit-scrollbar-thumb {
    min-width: 32px;
    min-height: 32px;
    border: 2px solid transparent;
    border-radius: 9999px;
    background-color: transparent;
    background-clip: padding-box;
  }

  :hover { --scrollbar-hover: 1; }
  :hover::-webkit-scrollbar-thumb { background-color: var(--border-muted); }
  ::-webkit-scrollbar-thumb:hover,
  ::-webkit-scrollbar-thumb:active { background-color: var(--border-strong); }

  @supports not selector(::-webkit-scrollbar) {
    * {
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }
    :hover {
      scrollbar-color: var(--border-muted) transparent;
    }
  }
}
```

## 4. Desktop Shell Details (When Shipping Electron / Tauri)

- Persist the active theme's background color and pass it to window creation
  before first paint (no white flash on dark startup); sync `nativeTheme` so
  OS window controls follow the app theme, and invalidate window shadow on macOS
  when theme background changes.
- Native embedded browser views (`WebContentsView`) ignore CSS `border-radius`.
  Overlay subpixel-antialiased premultiplied-BGRA corner mask bitmaps -
  including the surrounding card's hairline border arc - over the view corners.
