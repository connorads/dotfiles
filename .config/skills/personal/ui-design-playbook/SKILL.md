---
name: ui-design-playbook
description: >-
  Concrete rules for building or restyling UI in code: visual hierarchy,
  spacing and layout, type scales, colour palettes, depth and shadows, images,
  and finishing flourishes. Consult WHILE building, styling, restyling, or
  design-reviewing an interface - whenever something needs to "look better",
  feel more polished, or when setting up spacing / type / colour systems.
  Framework-agnostic, with a separate Tailwind v4 mapping.
---

# UI Design Playbook

A build/refactor playbook for shipping UI that looks designed, not defaulted.
You do not need design training to apply it - each rule is a directive plus the
reason behind it.

## When to use

Pull this in when you are:

- Building a new screen, component, or page from scratch.
- Restyling or polishing existing UI ("make this look better / more premium").
- Doing a design review of someone's markup or styles.
- Setting up the foundational systems: spacing scale, type scale, colour
  palette, elevation ramp.
- Stuck on a specific symptom: cramped layout, flat/muddy look, weak
  hierarchy, garish colours, unreadable text over an image.

Read the matching reference file before you start - don't guess from the index
alone. The index is a map, the references hold the actual directives, rationale,
and snippets.

## How to work

1. If starting fresh, skim `references/process.md` first - it governs sequence
   (feature-first, grayscale-first, systems over one-offs).
2. Jump to the reference for the problem in front of you.
3. If the project uses Tailwind, read `references/tailwind.md` to translate the
   plain-CSS guidance into utility classes and tokens.

## Rule index

### Process & systems → `references/process.md`

Feature-first, not page-first · design the smallest real task · sketch low-fi
in grayscale · short build/restyle cycles, ship the smallest useful version ·
give the product a deliberate personality (type, colour, radius, voice) · limit
your options · define systems up front and decide by elimination.

### Visual hierarchy → `references/hierarchy.md`

Hierarchy beats surface styling · don't lean on size alone - use weight and
colour · two text weights, two-or-three text colours · soft/tinted greys for
supporting text · de-emphasise to emphasise · drop or demote labels · separate
visual from document hierarchy · rank actions (primary / secondary / tertiary)
rather than styling by semantics · keep destructive actions quiet until
confirmation.

### Spacing & layout → `references/spacing-layout.md`

Start spacious then tighten · constrain to a ratio-based spacing scale · don't
fill the full width - size each section to its content · split into columns
instead of stretching · fixed sidebar + flexible content, cap with max-width ·
more space between groups than within · tie labels to their inputs.

### Typography → `references/typography.md`

Fixed, non-linear type scale (hand-picked, whole pixels) · neutral sans with
many weights and a system fallback · measure of 45-75 characters · line-height
scales with length and inversely with size · left-align by default, never
centre long text · right-align numeric columns · tighten large headlines, widen
all-caps.

### Colour → `references/colour.md`

Work in HSL · build a full palette (greys, primaries, accents, semantics), not
five swatches · predefine ~9 shades per colour, never compute on the fly · avoid
pure black · trust eyes over maths · use perceived brightness and small hue
rotations for natural ramps · tint and keep greys consistent in temperature ·
meet contrast minimums and never rely on colour alone.

### Depth & elevation → `references/depth.md`

Light from above · pair a soft cast shadow with a tight contact shadow · shadow
size = distance, closer pulls focus · define an elevation scale and map it to
role · press elements down on interaction · achieve depth flat via colour,
overlap, and solid offset shadows.

### Images → `references/images.md`

Source real photography · fix the image (overlay, lower contrast, colourise),
not the text · respect intended size - don't enlarge icons or shrink full
screenshots · crop or abstract when space is tight · constrain user image shape
and prevent background bleed with an inner border.

### Finishing touches & levelling up → `references/finishing-touches.md`

Supercharge existing elements (icons for bullets, styled quotes/links, custom
controls) · accent borders and subtle backgrounds · design empty states first ·
reach for borders less - separate with shadow, background, or spacing · rethink
component conventions · advanced flourishes: inverted selected states, nested
controls in inputs, two-tone headlines, layered shadows · build to learn and
keep a curious eye.

### Tailwind v4 mapping → `references/tailwind.md`

How the spacing, type, colour, and shadow systems above map onto Tailwind v4
tokens and utilities. Read when the project uses Tailwind.
