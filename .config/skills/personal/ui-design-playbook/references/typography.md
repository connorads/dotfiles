# Typography

Canonical rules for type in interfaces: choosing sizes, picking a face, keeping text readable, and the small finishing touches. Two finishing overlaps (tight heading line-height, spaced-out uppercase) also appear in the polish reference; their definitive typographic form lives here.

## The type scale

**Define a fixed scale.** Pick a constrained set of sizes up front and only ever use values from it; never reach for an arbitrary pixel value per element. An unbounded range breeds inconsistency and slows every sizing decision.

```css
:root {
  --text-xs:  12px;
  --text-sm:  14px;
  --text-base:16px;
  --text-lg:  18px;
  --text-xl:  20px;
  --text-2xl: 24px;
  --text-3xl: 30px;
  --text-4xl: 36px;
  --text-5xl: 48px;
  --text-6xl: 60px;
}
```

**Make the scale non-linear.** Use small steps between the smaller sizes and progressively larger jumps toward the top. Fine control matters for body text; nobody needs to choose between 46px and 48px for a headline.

**Prefer hand-picked over modular.** For interface work, choose values by hand rather than generating them from a fixed ratio. A formula yields fractional, awkward sizes and rarely gives the in-between values UI actually needs.

**Round away fractions.** If you do derive sizes from a ratio, round each result to a whole pixel before committing it. Browsers round subpixel values differently, causing off-by-one rendering inconsistencies.

**Avoid `em` for sizes.** Define scale sizes in `px` or `rem`, not `em`. `em` compounds with the parent font size, so nested elements compute to values that fall outside your scale.

```css
.card       { font-size: 1.25rem; }
.card .meta { font-size: 0.875rem; } /* both land on scale values, not 17.5px */
```

## Choosing a typeface

**Default to a neutral sans-serif.** For general UI, pick a plain face rather than one with strong personality. Neutral faces are familiar and legible, carrying an interface without distracting users.

**Fall back to the system stack.** When unsure of your taste, use the native font stack instead of a custom face. It looks native, loads instantly, and users already read it everywhere.

```css
font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans',
             Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
```

**Favour many weights.** As a filter, skip families offering fewer than ~5 weights; bias toward 10+ styles. More weights signal more care, and give you range for hierarchy.

**Pick faces built for your size.** Use text-optimised faces (wider spacing, taller x-height) for body copy; avoid condensed, short-x-height display faces there. A headline face used as body text reads poorly at small sizes.

**Sort by popularity when in doubt.** Use a font directory's popularity ranking to narrow choices, especially for a face with personality. Widely adopted fonts are safe bets backed by thousands of other designers' judgement.

**Borrow from well-designed sites.** Inspect the typefaces on sites you admire and reuse their choices. Strong teams surface great fonts you'd never reach through the safe, generic routes.

## Readability

**Cap line length at 45-75 characters.** Constrain paragraph width to that range; don't let text stretch to fill the layout. Over-long lines make it hard for the eye to track from one line to the next.

**Set measure with `em` width.** Use a `max-width` of roughly 20-35em to land in the ideal range. Because `em` scales with font size, the character count stays right at any text size.

```css
article { max-width: 33em; } /* ~45-75 characters */
```

**Limit paragraph width inside wider content.** When prose sits beside images or large components, keep the text column narrow even where the surrounding area is wide. Mixed widths in one area look more polished than forcing prose to span the full block.

**Align mixed sizes on the baseline.** When different font sizes share a line, align by baseline rather than vertically centring. The baseline is a reference the eye already perceives, giving a cleaner result than offset, centred text.

```css
.row { display: flex; align-items: baseline; }
```

**Scale line-height with line length.** Pair line-height to measure: tighter (~1.5) for narrow columns, looser (up to 2) for wide ones. The further the eye jumps back horizontally, the more vertical space it needs to find the next line.

**Scale line-height inversely with size.** Give small text generous line-height and large headlines tight line-height, down to 1 for big display text. Small wrapping text needs help finding the next line; large text does not.

```css
body { line-height: 1.6; }
h1   { line-height: 1.05; }
```

## Links and alignment

**Don't colour every link.** In link-dense interfaces, drop the classic coloured-link treatment and emphasise most links subtly with a heavier weight or darker shade. A pop treatment meant to surface a lone link in prose overwhelms when everything is a link.

**Reveal minor links on hover.** For ancillary, off-path links, show an underline or colour change only on hover. They stay discoverable without competing with the page's primary actions.

```css
a.subtle        { color: inherit; text-decoration: none; }
a.subtle:hover  { text-decoration: underline; }
```

**Left-align by default.** Align body text to match the language's reading direction, which for English means left. It matches how readers scan, making text easiest to follow.

**Don't centre long text.** Reserve centre alignment for headlines or short blocks; left-align anything longer than two or three lines. Centred multi-line text gives every line a ragged left edge, breaking the eye's return path.

**Shorten copy to fix centring.** If one of several centred blocks runs too long, rewrite it shorter rather than left-aligning just that one. This restores the alignment and keeps the design consistent.

**Right-align numeric columns.** Right-align numbers in tables so their decimal points line up. Aligned decimals make magnitudes far easier to compare at a glance.

```css
td.num { text-align: right; font-variant-numeric: tabular-nums; }
```

**Hyphenate when justifying.** If you justify text, always enable hyphenation alongside it. Justification without hyphenation opens ugly gaps between words.

```css
p.justified { text-align: justify; hyphens: auto; }
```

## Letter-spacing

**Leave it alone by default.** Trust the designer's spacing and adjust only in the few cases that genuinely call for it. Built-in spacing is tuned for the face's intended use; arbitrary tweaks usually hurt.

**Tighten large headlines.** When using a body-optimised face for big headlines, reduce its letter-spacing slightly; never try to loosen a headline face into small body text. Body faces are spaced wide for legibility, so tightening mimics a purpose-built display face, but the reverse rarely works.

```css
h1 { letter-spacing: -0.02em; }
```

**Widen all-caps text.** Increase letter-spacing on all-uppercase text. Caps are uniform in height with few distinguishing features, so default spacing reads cramped.

```css
.eyebrow { text-transform: uppercase; letter-spacing: 0.05em; }
```
