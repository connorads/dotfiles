# Spacing & Layout

How to size and space a UI in code: a density philosophy, a spacing scale, width and responsive rules, and grouping rules. Plain CSS throughout - none of this is tied to any framework.

## Density philosophy

**Start spacious, then tighten.** Open every layout with more white space than feels comfortable, then subtract until it looks right - never start cramped and add padding only until it stops looking bad. Subtracting from a generous start lands on genuinely clean spacing; adding the bare minimum lands on cramped.

**Generous-local reads as just-right.** Judge spacing against the whole screen, not one isolated element. Space that looks excessive around a single component usually settles into balance once the rest of the UI surrounds it.

**Make density deliberate.** Default to breathing room. Compress a layout only when packing lots of data onto one screen is a conscious, justified choice - a dashboard, a data table - not the lazy default. Missing white space is easy to spot and fix; accidental density slips through unnoticed.

## The spacing scale

**Constrain to a scale.** Pick sizes and gaps from a small predefined set instead of nudging arbitrary pixels one at a time. Endless one-pixel trialing is slow and breeds inconsistency; a fixed palette of values makes each choice fast and coherent.

**Scale by ratio, not fixed step.** Keep each step a meaningful percentage jump from the last - roughly 25%+ apart - rather than a constant linear increment. A few pixels matter enormously at small sizes and are invisible at large ones, so equal steps don't help you choose.

**Derive the scale from a base.** Generate values from a sensible base using factors and multiples rather than inventing each number. 16px is a strong base: it divides cleanly and is the browser default font size. This packs values tightly at the small end and widens the gaps toward the large end - small elements need fine increments, large ones need coarse jumps.

```css
/* base 16px, ratio-spaced */
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
  --space-10: 128px;
}
```

## Width & responsive

**Don't fill the whole width.** Use only the width the content needs. If 600px reads well, use 600px and leave the edges empty rather than stretching across a 1200px+ canvas. Over-wide layouts are harder to scan; extra edge space never hurts.

**Width per section, not matched.** Size each section to its own content. Don't make a block full-width just because the nav or a neighbour is. Matching widths for consistency's sake degrades a section that would read better narrower.

**Shrink the canvas to design small.** When a compact interface is hard to design on a big screen, narrow the canvas (around 400px) and design the mobile layout first, then expand. Real constraints make small designs easier, and scaling a finished mobile layout up needs fewer changes than you'd expect.

**Split into columns, not wider.** If a layout works best narrow but feels lost in a wide space, break it into multiple columns instead of stretching it. Moving supporting content into a side column balances the composition without compromising the element's ideal width.

**Don't cram either.** Just as you needn't fill the screen, don't force everything into a tiny area. Let the content dictate the footprint - forced compactness harms usability as much as forced width.

**Not everything should be fluid.** Reserve percentage widths for elements you actually want to scale; give the rest fixed widths tuned to their contents. Outsourcing every width to a grid forces relative sizing onto elements that have a single ideal size.

**Fixed sidebar, flexible content.** Give a sidebar a fixed width optimised for its contents and let the main area flex to fill the rest. A percentage sidebar wastes space when wide and wraps or truncates awkwardly when narrow.

```css
.layout { display: flex; }
.sidebar { width: 280px; flex: none; }
.content { flex: 1; }
```

**Cap with max-width, shrink late.** Don't shrink an element before you must. Give it a max-width so it stops growing at its ideal size, and let it shrink only once the screen is narrower than that. Fluid grid widths can make an element wider on medium screens than large ones; a max-width keeps it optimal whenever there's room.

```css
.card { width: 100%; max-width: 500px; margin: 0 auto; }
```

**Relative units don't hold across sizes.** Don't assume a ratio like headline = 2.5x body stays right at every screen size. A headline that's 2.5x body on desktop becomes far too large against reduced mobile body copy. Re-tune type sizes per breakpoint instead of locking them with `em`.

**Large shrinks faster than small.** On smaller screens, reduce large elements more aggressively than already-small ones so the size gap between them narrows. Scale everything by the same factor and big-on-desktop elements overwhelm a small screen - the contrast should ease at small sizes.

**Tune component props independently.** Don't tie a component's padding to its font size. Adjust each property separately so larger variants get proportionally more padding and smaller ones get tighter padding. Pure proportional scaling just looks like a zoom; independent tuning makes large buttons feel genuinely larger and small ones genuinely smaller.

```css
.btn-sm { font-size: 14px; padding: 6px 10px; }
.btn-lg { font-size: 18px; padding: 14px 24px; }
```

## Grouping

**More space around a group than within.** When spacing alone does the grouping, always leave more space around a group than between its members. Equal inner and outer spacing makes related items read as disconnected and forces the user to work harder.

```css
.field { margin-bottom: 8px; }
.field-group { margin-bottom: 24px; }
```

**Connect labels to their inputs.** In stacked forms, keep each label tight to its own input and add clear separation between groups. If the gap below a label equals the gap below its input, users misread which label owns which field and enter data in the wrong place.

```css
label { margin-bottom: 4px; }
.field { margin-bottom: 24px; }
```

**Separate headings and list items.** Give section headings noticeably more space above than below, and set list-item gaps larger than a single line's height. When a heading sits as close to the previous section as to its own, or bullets are spaced like wrapped lines, grouping turns ambiguous.

```css
h2 { margin-top: 48px; margin-bottom: 12px; }
li { margin-bottom: 12px; line-height: 1.4; }
```

**Spacing groups horizontally too.** Apply the more-around-than-within rule to horizontal layouts, not just vertical stacks. Side-by-side items suffer the same grouping confusion when the space between items matches the space within a group.
