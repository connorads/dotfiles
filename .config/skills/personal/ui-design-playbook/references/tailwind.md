# Tailwind v4 Mapping

> Tracks Tailwind CSS v4. Verify specific tokens/utilities against the live docs at tailwindcss.com (theme, colors, spacing, font-size, box-shadow, border-radius, upgrade-guide).

How to read this file: each section gives the framework-agnostic principle in one line, then the concrete v4 tokens/utilities to reach for. This is the only reference here that mentions Tailwind.

## The v4 model in one breath

v4 is CSS-first. Design tokens are plain CSS custom properties declared in an `@theme` block, not a JS config object. Declaring a token does two things at once: it generates the matching utilities **and** exposes a live CSS variable you can use anywhere.

```css
@import "tailwindcss";

@theme {
  --color-brand-500: oklch(63% 0.2 255);
  --spacing: 0.25rem;
  --radius-lg: 0.5rem;
}
```

Now `bg-brand-500` works as a utility, and `var(--color-brand-500)` works in arbitrary values, hand-written CSS, and inline styles. A design system is implemented by overriding these namespaced variables - not by editing config.

Namespaces: `--color-*`, `--font-*`, `--text-*`, `--font-weight-*`, `--tracking-*`, `--leading-*`, `--spacing`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`, `--breakpoint-*`, `--container-*`, `--ease-*`, `--animate-*`, `--aspect-*`.

Override a default by redeclaring the same variable name. Wipe a whole namespace with `--color-*: initial;` then redefine it.

**v4 change:** `tailwind.config.js` is replaced by the `@theme` block; tokens are real CSS variables by default, not build-time-only values. A JS config can still be opt-in loaded via `@config` for migration, but `@theme` is canonical.

## Spacing scale

Principle: derive all spacing from one base unit so density retunes globally.

Everything flows from a single `--spacing` token (default `0.25rem` = 4px). Numeric utilities compute off it:

```css
/* p-4  -> calc(var(--spacing) * 4) = 1rem */
/* px-8, gap-2, w-16, size-10, p-1.5 ... all derived */
@theme {
  --spacing: 0.25rem; /* change this one line to rescale the whole system */
}
```

Any integer or half-step (`p-1.5`) is valid without enumerating it. Reach for `p-*`, `px-*`/`py-*`, `m-*`, `gap-*`, `w-*`/`h-*`/`size-*`, `space-x-*`/`space-y-*`, `inset-*`.

**v4 change:** v3's fixed list of rem values became one computed multiplier, so arbitrary multiples work by default and the whole scale moves from a single variable.

## Type scale

Principle: pick sizes from a constrained modular scale, not arbitrary px.

Use the `--text-*` namespace:

| Utility | Size |
| --- | --- |
| `text-xs` | 0.75rem |
| `text-sm` | 0.875rem |
| `text-base` | 1rem |
| `text-lg` | 1.125rem |
| `text-xl` | 1.25rem |
| `text-2xl` | 1.5rem |
| `text-3xl` | 1.875rem |
| `text-4xl` | 2.25rem |
| `text-5xl` | 3rem |
| `text-6xl` | 3.75rem |
| `text-7xl` | 4.5rem |
| `text-8xl` | 6rem |
| `text-9xl` | 8rem |

Each step carries paired metadata via the double-dash sub-property convention. Define a custom step the same way:

```css
@theme {
  --text-tiny: 0.6875rem;
  --text-tiny--line-height: 1.4;
  --text-tiny--letter-spacing: 0.01em;
  --text-tiny--font-weight: 500;
}
```

Override line-height per use with the `text-sm/6` size/line-height shorthand. Pair with `--leading-*` (line-height), `--tracking-*` (letter-spacing), `--font-weight-*`.

**v4 change:** font-size and its paired line-height/letter-spacing/weight are co-located on one `--text-*` variable using `--text-*--line-height` syntax, replacing v3's `fontSize: { sm: ['0.875rem', { lineHeight: ... }] }` array form.

## Colour shades (50-950)

Principle: each colour is an 11-step ramp; pick by step, not by eyeballing a hex.

Ramps map to `--color-{name}-{50..950}`: steps `50,100,200,300,400,500,600,700,800,900,950`. The default palette ships 22 families - 17 chromatic (red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose) and 5 neutrals (slate, gray, zinc, neutral, stone) - plus `--color-black` and `--color-white`.

Utilities: `bg-sky-500`, `text-rose-300`, `border-slate-200`. Alpha via the slash modifier: `bg-sky-500/75`.

Add a brand ramp by declaring the full set in `@theme`:

```css
@theme {
  --color-brand-50:  oklch(97% 0.02 255);
  --color-brand-100: oklch(94% 0.04 255);
  /* ... 200 ... 800 ... */
  --color-brand-900: oklch(30% 0.09 255);
  --color-brand-950: oklch(22% 0.06 255);
}
```

**v4 change:** the default palette is now defined in OKLCH (e.g. `--color-red-500: oklch(63.7% 0.237 25.331)`) instead of hex/RGB, giving wider-gamut, more perceptually uniform ramps exposed as `--color-*` variables. Note: taupe/mauve/mist/olive are not real Tailwind colours.

## Elevation / shadow ramp

Principle: use a fixed set of elevation steps so "raised" reads consistently everywhere.

Outer elevation uses `--shadow-*`: `shadow-2xs`, `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, plus `shadow-none`. Inset elevation has its own ramp: `inset-shadow-2xs`, `inset-shadow-xs`, `inset-shadow-sm`.

Tune shadow colour with `shadow-<color>` (sets `--tw-shadow-color`). Round out the toolkit with `ring` (now 1px default; use `ring-3` for the old 3px) and filter-based `drop-shadow-*`.

**v4 change:** the whole ramp was renamed one notch smaller with a new bottom step:

| v3 | v4 |
| --- | --- |
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| _(new)_ | `shadow-2xs` |
| `drop-shadow-sm` | `drop-shadow-xs` |
| `drop-shadow` | `drop-shadow-sm` |

Dedicated `inset-shadow-*` utilities are new in v4.

## Border radius

Principle: keep corner rounding on one scale; match radius to element size.

Use `--radius-*`:

| Utility | Approx |
| --- | --- |
| `rounded-none` | 0 |
| `rounded-xs` | ~2px |
| `rounded-sm` | ~4px |
| `rounded-md` | ~6px |
| `rounded-lg` | ~8px |
| `rounded-xl` | ~12px |
| `rounded-2xl` | ~16px |
| `rounded-3xl` | ~24px |
| `rounded-4xl` | ~32px |
| `rounded-full` | `calc(infinity * 1px)` |

Per-corner and per-side variants inherit the same tokens: `rounded-t-*`, `rounded-tl-*`, and logical `rounded-s-*`/`rounded-e-*`. Customise by overriding `--radius-lg` etc.

**v4 change:** like shadows, the ramp shifted one notch - v3 `rounded-sm` -> v4 `rounded-xs`, and v3 `rounded` (unsuffixed) -> v4 `rounded-sm`; `rounded-4xl` was added at the top. `rounded-full` now uses `calc(infinity * 1px)` rather than a large fixed px value.
