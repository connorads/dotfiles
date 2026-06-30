# Finishing Touches & Levelling Up

Polish is what separates a working interface from one that feels considered. Most of it comes from restyling what you already have, designing the states people forget, and questioning conventions you never thought to question. The final section sharpens the underlying skill: training your eye to spot the moves that make good design good.

## Supercharge existing elements

Before reaching for new components, restyle the ones already in your markup - lists, quotes, links, form controls. You can travel a long way from plain to polished without adding a single element.

**Swap bullets for icons.** Replace default list markers with meaningful icons: a generic check or arrow, or something topical like a padlock beside security points. Icons add colour and carry meaning a plain dot cannot.

```css
li { list-style: none; }
li::before { content: url(check.svg); margin-right: .5rem; }
```

**Promote quotes into focal points.** Enlarge and recolour testimonial quotes instead of leaving them as body copy. A promoted quote pulls the eye and gives social proof real weight.

```css
blockquote { font-size: 1.5rem; color: #4f46e5; }
```

**Style links distinctively.** At minimum give links a colour and heavier weight; for more flair, use a thick underline that sits behind the text. Deliberate links read as design, not default browser blue.

```css
a {
  font-weight: 600;
  color: #4338ca;
  text-decoration-thickness: .2em;
  text-underline-offset: -.05em;
}
```

**Customise form controls.** Replace browser-default checkboxes and radios with versions that use a brand colour for the selected state. One branded accent makes a form feel finished rather than generic.

```css
input:checked { accent-color: #4f46e5; }
```

**Add accent borders.** When you lack photography or illustration skills, drop a small colourful bar onto an otherwise bland region. A flat coloured rectangle reads as intentional and needs zero graphic talent.

```css
.card { border-top: 4px solid #4f46e5; }
```

**Reuse accent bars in many placements.** The same cheap device works across a card's top edge, on the active nav item, down the side of an alert, as a short underline under a headline, or spanning the whole layout's top edge - adding colour and signalling state wherever it lands.

```css
.alert { border-left: 4px solid #d97706; }
```

**Recolour backgrounds.** Shift a section or panel's background colour to break monotony and separate page regions. A different background emphasises a panel and divides one section from the next without restructuring anything.

```css
.section--alt { background: #f3f4f6; }
```

**Use subtle gradients between close hues.** For an energetic background, fade between two hues no more than ~30 degrees apart on the wheel. Narrow gaps stay tasteful; wide ones look garish.

```css
background: linear-gradient(120deg, #4f46e5, #7c3aed);
```

**Add low-contrast patterns.** A subtle repeating pattern adds texture - optionally only along one edge - as long as the contrast between pattern and background stays low enough to protect readability.

```css
background-color: #4f46e5;
background-image: url(pattern.svg); /* pattern ~5-10% lighter than the base */
```

**Place decorative shapes deliberately.** Rather than blanketing a background, drop one or two graphics - simple geometric shapes, a slice of a pattern, or a simplified illustration like a faint world map - in chosen spots. Targeted decoration adds interest without overwhelming the layout.

**Keep all decoration low-contrast.** Whether a full pattern or a single shape, decorative elements must stay quiet so they never compete with content. Decoration sits behind the message, never fights it.

## Empty & supporting states

**Design the empty state first.** For any feature driven by user-generated content, treat the empty state as a priority, not an afterthought - it is often a user's very first impression of the feature.

**Make empty states engaging.** Add an image or illustration and emphasise the call-to-action that moves the user forward. An inviting empty state encourages the first action instead of looking broken.

**Hide supporting UI that does nothing.** When there is no content, hide tabs, filters, and other controls that have no effect until data exists. Showing actions that do nothing only confuses and clutters the first experience.

## Separation without borders

**Reach for borders less often.** When two elements need separating, resist defaulting to a border - overusing them makes a UI feel busy. A border is one separation tool among several, not the only one.

**Separate with shadow.** A subtle box shadow can outline an element in place of a border, working best when the element's colour differs from its background. It achieves the same containment more quietly than a hard line.

```css
box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
```

**Separate with background colour.** Give adjacent elements slightly different backgrounds, and drop any border sitting alongside that colour change - the shift usually creates enough distinction on its own, making the border redundant.

```css
.panel { background: #fff; }
.page  { background: #f3f4f6; }
```

**Separate with spacing.** Increase the gap between groups to signal separation with no new UI at all. More distance is the simplest way to say elements belong to different groups.

## Rethink conventions

**Question how a component "must" look.** The conventional form of a component is rarely the only valid one. Preconceived templates quietly cap how effective your design can be.

**Reinvent dropdowns.** Treat a dropdown as a free-floating box: split it into sections, use multiple columns, or add supporting text and colourful icons instead of a plain list of links. A richer menu carries more meaning and feels more considered.

**Rethink table columns.** When a column does not need to be sortable, merge it with a related column to build hierarchy rather than allotting one datum per column. Combining columns breaks up flat, monotonous rows.

**Enrich table cells.** Let cells hold more than plain text - images or colour make the data clearer and faster to read than rows of identical text.

**Turn radio groups into selectable cards.** When a radio choice is central to the UI, replace the labels-and-circles with selectable cards. Cards make an important decision tangible and engaging instead of dull.

## Levelling up your design eye

The techniques above are finite; the skill of finding new ones is not. Most growth comes from studying work you admire and isolating the decisions you would never have made yourself.

**Study unfamiliar decisions.** When an interface impresses you, ask what the designer did that you would never have thought to do, then write that specific choice down. The unintuitive micro-decisions are where new techniques hide, and collecting them steadily widens your toolkit.

**Invert the selected state.** Flag the active item by swapping foreground and background - a chosen date gets a filled background and light text - rather than only outlining it. A solid colour swap reads as "chosen" far more clearly than a border or faint tint.

```css
.day--selected { background: #2563eb; color: #fff; }
```

**Nest controls inside inputs.** Tuck an action button or icon into the field's padding instead of bolting it onto the outer edge. Keeping the control inside unifies the input visually and saves horizontal space.

```css
.field { position: relative; }
.field input { padding-right: 2.5rem; }
.field button {
  position: absolute;
  right: .25rem;
  top: 50%;
  transform: translateY(-50%);
}
```

**Two-tone a headline.** Use two text colours within a single heading to split the emphasised part from the secondary part. Colour contrast on one line creates hierarchy without touching size or weight.

```html
<h1>
  <span style="color:#111">Plans for</span>
  <span style="color:#6b7280">every team</span>
</h1>
```

**Rebuild to learn.** Recreate interfaces you admire from scratch and resist opening their dev tools until you are genuinely stuck. Reverse-engineering by eye forces you to notice the subtle details that make a design feel finished.

**Keep a curious eye.** Make examining inspiring work a continuous habit, not a one-off. Design skill compounds: steady attention to good examples keeps yielding new tricks for years.

A few advanced flourishes overlap with the canonical references - apply them here too, but follow the dedicated files for the detail:

- **Tighten line height on large headings** so stacked lines sit closer - see `typography`.
- **Add letter-spacing to uppercase text** to restore legibility - see `typography`.
- **Layer multiple box-shadows** of differing blur and offset for realistic elevation - see `depth`.
