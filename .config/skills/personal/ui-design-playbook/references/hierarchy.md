# Visual Hierarchy

Hierarchy is the lever that makes an interface feel designed. Rank what matters, push it forward, and deliberately hold everything else back. The rules below cover the core principle, how to wield colour and weight, concrete emphasis tactics, and how to order actions.

## Core principle

- **Hierarchy beats surface styling.** Rank elements by importance and emphasise the few that matter; actively de-emphasise secondary and tertiary content. When everything fights for attention the screen reads as a wall of noise - ranking is what makes a layout look intentional.
- **Don't lean on size alone.** Carry emphasis with weight and colour, not just font size. Size-only hierarchy inflates primary text and shrinks secondary text into illegibility at both ends.
- **Bold instead of bigger.** To lift a primary element, raise its weight rather than its size. Weight signals importance while keeping type at a comfortable, readable scale.

## Text colour and weight

- **Soft colour for supporting text.** De-emphasise secondary text with a lighter colour, not a smaller size - a softer colour reads as "secondary" while staying legible.

  ```css
  color: #6b7280; /* secondary, not 11px */
  ```

- **Limit to a few text colours.** Stick to roughly three neutral shades - dark for primary, grey for secondary, lighter grey for tertiary. A small fixed set keeps importance levels consistent across the UI.

  ```css
  --text-primary:   #1a202c;
  --text-secondary: #718096;
  --text-tertiary:  #a0aec0;
  ```

- **Two weights are enough.** One normal weight (400-500) for most text, one heavier weight (600-700) for emphasis. Two weights give clear contrast without competing steps.

  ```css
  --font-normal: 400;
  --font-bold:   600;
  ```

- **Avoid sub-400 weights for UI.** Never use weights below 400 for interface text; reserve thin weights for large headings only. De-emphasise with lighter colour or smaller size instead, because thin weights are unreadable at small sizes.
- **Grey is just reduced contrast.** Greying works by lowering contrast against the background. That only holds on white - on a coloured background, shift the text toward the background colour rather than reaching for grey, which just looks wrong there.
- **Avoid white-at-low-opacity on colour.** Don't de-emphasise text on coloured surfaces by dropping white opacity. Transparent white looks dull and washed out, can read as disabled, and lets any underlying pattern bleed through the letters.
- **Hand-pick tinted text colours.** On a coloured background, de-emphasise by choosing a solid colour that shares the background's hue, then tune its saturation and lightness until contrast feels right. A same-hue colour lowers contrast cleanly without the faded, see-through look of transparency.

  ```css
  background: #1e3a8a;
  color:      #6b8bd0; /* same hue, tuned S/L */
  ```

## Emphasis tactics

- **Emphasise by de-emphasising.** When an element won't stand out and you can't add to it, quiet the things competing with it instead of pushing it harder. Lowering surrounding noise avoids an emphasis arms race.
- **Quiet competing regions.** When a secondary area like a sidebar fights the main content, drop its background fill and let it sit on the page background so the primary area becomes the clear focus.

### Labels

- **Drop labels when format reveals type.** Omit a label when the value's own format identifies it - an email, phone number, or price needs no caption. Redundant labels force every datum into equal emphasis and kill hierarchy.
- **Let context replace labels.** Skip the label when surrounding context already makes meaning clear, e.g. a department shown under a person's name. Label-free data is far easier to style with emphasis.
- **Fold the label into the value.** When a bare value is ambiguous, add a clarifying word to it rather than a separate label - "12 left in stock" over "In stock: 12", "3 bedrooms" over "Bedrooms: 3". One combined phrase styles freely while staying clear.
- **Treat necessary labels as secondary.** When you genuinely need labels for repeated, scannable data, keep them as supporting content - smaller, lower contrast, lighter weight, or a mix. The data is the point; the label only exists for clarity.
- **Emphasise labels when users scan for them.** On dense, spec-style pages where users hunt for the label term, emphasise the label over the value and only slightly soften the data with a marginally lighter colour. People scan tech specs for words like "depth", not the number - but the number still matters, so don't bury it.

### Headings and structure

- **Separate visual from document hierarchy.** Pick heading tags for semantics, then style purely for visual hierarchy - an `h1` need not be large just because it's an `h1`. Default browser heading sizes suit articles but tempt oversized application titles that steal focus.
- **Make section titles small.** Style section titles like quiet labels - often small and understated - since the content is the focus, not its heading.
- **Hide titles that add nothing visually.** Where content speaks for itself, keep the title in markup for accessibility but hide it visually. Screen-reader users keep the structure; sighted users skip the redundant heading.

  ```css
  .visually-hidden{
    position:absolute; width:1px; height:1px;
    overflow:hidden; clip:rect(0 0 0 0);
  }
  ```

### Balancing weight and contrast

- **Counterbalance heavy elements with lower contrast.** Heavier elements cover more surface and pull focus, so soften a too-heavy item - like a solid icon - with a lower-contrast colour. You can't change an icon's weight, so reducing contrast restores balance with adjacent text.

  ```css
  color:#9ca3af; /* soften the icon */
  ```

- **Boost weight to lift low-contrast elements.** When a soft element like a thin 1px border is too faint but darkening it looks harsh, add thickness instead. More width emphasises it while preserving the quiet colour.

  ```css
  border:2px solid #e5e7eb; /* heavier, still soft */
  ```

## Action hierarchy

- **Rank actions, don't just style by semantics.** Place every action in an importance order: one primary action gets the strongest treatment, secondary actions a clear-but-quieter one, tertiary actions a minimal one. Styling buttons by semantic meaning alone ignores importance and produces a busy, unclear UI.
- **Primary** - a single solid, high-contrast button, unmistakable on the page.
- **Secondary** - clear but not prominent: outlines or lower-contrast fills, findable without competing with the primary.
- **Tertiary** - rarely used actions styled like plain links: discoverable but unobtrusive, never drawing the eye like a button.

  ```css
  .btn-primary   { background:#2563eb; color:#fff; }
  .btn-secondary { background:transparent; border:1px solid #cbd5e0; color:#1a202c; }
  .btn-tertiary  { background:none; border:none; color:#2563eb; text-decoration:underline; }
  ```

- **Don't auto-shout destructive actions.** Don't make an action big, red, and bold just because it's destructive. If it isn't the page's primary action, give it a secondary or tertiary treatment - severity is not importance, and loud destructive buttons add noise where they shouldn't lead.
- **Promote destructive emphasis at confirmation.** Reserve big, red, bold styling for the confirmation step, where the destructive action genuinely is the primary action. Emphasis lands where the decision is actually made, keeping the originating page calm.
