// TEMPLATE - single source of truth for the webfont glyph coverage.
//
// Copy into a project and adapt the ranges. The point of one shared module is
// that BOTH the subset generator (pyftsubset / glyphhanger / subfont wrapper)
// AND the built-output guard (check-dist.mjs) import it, so the shipped woff2
// and the coverage assertion can never drift: widen a range here, regenerate
// the fonts, and the guard follows.
//
// Why subset at all when a per-subset `latin` face already exists: even a
// `latin` webfont carries the full General-Punctuation block (U+2000-206F) plus
// arrows/maths that most copy never renders - that tail is real bytes. Re-subset
// down to the ranges actually used; keep them a touch wider than today's copy so
// a new loanword still renders. MEASURE the real before/after (see fonts.md); the
// headline "300KB -> 20KB" ratio assumes an unsubset source and rarely applies.

// Visible glyph ranges the subset (and each @font-face unicode-range) must cover.
// EXAMPLE default: Latin-1 + typographic punctuation for English marketing copy.
// Widen for other languages (add latin-ext, Greek, Cyrillic, etc.).
export const GLYPH_RANGES = [
  [0x20, 0x7e], // Basic Latin (printable ASCII)
  [0xa0, 0xff], // Latin-1 Supplement (café, £, ©, ®, °, ×, ÷, ...)
  [0x131, 0x131], // ı (dotless i)
  [0x152, 0x153], // Œ œ
  [0x2013, 0x2014], // – en dash, — em dash
  [0x2018, 0x201a], // ' ' ‚ single curly quotes
  [0x201c, 0x201e], // " " „ double curly quotes
  [0x2020, 0x2022], // † ‡ • dagger, double dagger, bullet
  [0x2026, 0x2026], // … ellipsis
  [0x2030, 0x2030], // ‰ per mille
  [0x2039, 0x203a], // ‹ › single angle quotes
  [0x20ac, 0x20ac], // € euro
  [0x2122, 0x2122], // ™ trade mark
  [0x2212, 0x2212], // − minus sign
];

// Whitespace that survives HTML-to-text extraction but needs no glyph.
export const IGNORED_CODEPOINTS = new Set([0x09, 0x0a, 0x0d]);

// Codepoint ranges the brand TEXT fonts are responsible for rendering. This is
// wider than GLYPH_RANGES on purpose: it is the "in scope" test, so the guard
// only fails on an uncovered codepoint that falls INSIDE these bands (a dropped
// accented letter). Decorative symbols (arrows U+2190+, stars, dingbats, emoji)
// sit outside and are deliberately left to the system font - they were never in
// the `latin` subset either, so an intentional decorative glyph must not fail the
// build while a missing text glyph does. Adapt the bands to your text fonts.
export const TEXT_SCOPE_RANGES = [
  [0x0000, 0x024f], // Basic Latin, Latin-1, Latin Extended-A/B
  [0x2010, 0x205e], // dashes, quotes, dagger, bullet, ellipsis, per-mille, angle quotes
  [0x20a0, 0x20bf], // currency symbols
  [0x2122, 0x2122], // ™
  [0x2212, 0x2212], // − minus
];

export const inFontScope = (cp) =>
  TEXT_SCOPE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");

// pyftsubset --unicodes / CSS unicode-range string, e.g. "U+0020-007E,U+00A0-00FF,...".
// Ranges are "U+<lo>-<hi>" with a bare high bound (no second U+).
export const unicodeRange = () =>
  GLYPH_RANGES.map(([lo, hi]) =>
    lo === hi ? `U+${hex(lo)}` : `U+${hex(lo)}-${hex(hi)}`,
  ).join(",");

export const isCovered = (cp) =>
  IGNORED_CODEPOINTS.has(cp) ||
  GLYPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
