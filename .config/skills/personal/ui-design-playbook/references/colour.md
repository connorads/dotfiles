# Colour

A working palette is a system, not a mood board. Define colours in a perceptual model, build a full set of named shades up front, tune them by eye, and verify contrast. Snippets are plain CSS.

## Colour model

- **Work in HSL, not hex.** Define and edit colours as HSL rather than hex or RGB, because HSL tracks how people perceive colour, so related colours stay related in code and adjustments are predictable.

  ```css
  /* same hue, two shades - relationship is obvious */
  --blue-500: hsl(220, 80%, 55%);
  --blue-700: hsl(222, 84%, 38%);
  ```

- **Know the three axes.** Hue is position on the wheel (0deg red, 120deg green, 240deg blue), saturation is vividness (0% grey to 100% intense), lightness is black-to-white (0% black, 50% pure colour, 100% white). Reasoning per-channel beats guessing.
- **Hue is moot at zero saturation.** Don't adjust hue when saturation is 0%; the colour is grey, so rotating hue changes nothing visible.
- **Use HSL, not HSB, for the web.** Author in HSL even though design tools default to HSB, and never paste HSB brightness into HSL lightness. Browsers speak HSL, not HSB, and the scales differ: 100% HSB brightness is white only at 0% saturation, while 100% HSB at full saturation equals 50% HSL lightness.

## Palette structure

- **Build a full palette, not five colours.** Skip five-swatch generators and assemble a comprehensive set across greys, primaries, and accents. Real UIs need far more than a handful of hex codes to cover every component and state.
- **Invest heavily in greys.** Grey is the workhorse - text, backgrounds, panels, controls - so provide 8-10 grey shades. Three or four runs out fast.

  ```css
  --grey-100: hsl(210, 24%, 96%);
  --grey-300: hsl(210, 18%, 87%);
  --grey-500: hsl(210, 14%, 66%);
  --grey-700: hsl(210, 16%, 42%);
  --grey-900: hsl(210, 24%, 16%);
  ```

- **Avoid pure black.** Start the darkest grey at a very dark grey, not `#000`, and step up to white evenly. True black looks unnatural in interfaces.
- **Give primaries a range.** Pick one or two primaries and provide 5-10 shades of each. Primaries carry identity and need ultra-light tints for backgrounds and dark variants for text.
- **Add semantic and accent colours.** Include accent colours for highlights plus semantics - red for destructive, yellow for warning, green for positive - each with several shades, used sparingly. One accent can't signal every state.
- **Scale colour count to complexity.** For data-rich UIs that colour-code elements (graph lines, calendar events, tags), budget up to ten colours with 5-10 shades each. Distinguishing many similar items demands a wide categorical palette.

## Building shades

- **Predefine shades, never compute on the fly.** Fix a discrete set of shades up front instead of calling `lighten()`/`darken()` at use time. Ad-hoc adjustments spawn dozens of near-identical colours and destroy the system.
- **Pick the base shade first.** Start each scale at a mid-scale base; for primaries and accents choose one that would look good as a button background. The base anchors the steps around it - there's no fixed lightness, so judge by eye.
- **Set the lightest and darkest edges by use.** Choose the extremes next, guided by where they live - darkest for text, lightest for tinted backgrounds. Anchoring to real use makes them practical, not arbitrary.
- **Fill gaps with nine shades.** With base, lightest, and darkest fixed, interpolate the middle. Prefer nine shades numbered 100-900 (base 500): set 700/300 first, then 800/600/400/200. Nine divides cleanly and halving yields an even scale.

  ```css
  /* 100 lightest ... 500 base ... 900 darkest */
  --c-100; --c-200; --c-300; --c-400;
  --c-500; --c-600; --c-700; --c-800; --c-900;
  ```

- **Anchor greys at the edges.** Build greys edge-first too: darkest from your darkest text, lightest from a subtle off-white background. The grey base matters less, but real-use extremes keep the ramp useful.
- **Trust eyes over maths.** Use the systematic method to start, then nudge saturation or lightness of individual shades by eye against real screens. No formula produces a perfect palette.
- **Resist palette creep.** Once the scale is set, don't add new shades casually. An ever-growing palette is no system at all.

## Making ramps feel natural

- **Raise saturation at the extremes.** Increase saturation as a shade moves away from 50% lightness toward 0% or 100%, because saturation's visual impact weakens near black and white - constant saturation leaves light and dark shades washed out.

  ```css
  --c-500: hsl(220, 70%, 50%);
  --c-200: hsl(220, 60%, 80%);
  --c-800: hsl(220, 80%, 28%);
  ```

- **Exploit perceived brightness of hues.** Each hue has an inherent brightness independent of HSL lightness - yellow reads lighter than blue at the same lightness. Perceived brightness peaks at yellow, cyan, magenta (60/180/300deg) and bottoms at red, green, blue (0/120/240deg). Use it deliberately.
- **Shift brightness by rotating hue.** To lighten without washing toward white, rotate hue toward the nearest bright hue (60/180/300deg); to darken without muddying, rotate toward the nearest dark hue (0/120/240deg). Changing lightness alone bleeds toward white or black and saps intensity; a hue rotation keeps richness.
- **Keep darker shades warm.** Building a scale for a light colour like yellow, rotate hue toward orange as you darken. It keeps dark shades warm and rich instead of dull brown.
- **Cap hue rotation at 20-30deg.** Limit brightness-driven rotation to about 20-30 degrees, optionally combined with lightness changes. Beyond that the swatch reads as a different colour, not a lighter or darker version of the same one.
- **Tint greys for temperature.** Add a little saturation to greys - blue for cool, yellow or orange for warm - instead of pure 0% grey. Subtle saturation gives a deliberate temperature that sets the UI's mood.

  ```css
  --grey-cool-500: hsl(215, 12%, 60%);
  --grey-warm-500: hsl(40, 12%, 60%);
  ```

- **Keep grey temperature consistent.** Bump saturation on the lighter and darker greys too so the temperature stays even. Without it, shades far from 50% lightness look washed out and break the warm/cool feel.

## Accessibility

- **Meet WCAG contrast minimums.** Normal text (under ~18px) needs at least 4.5:1 contrast; large text at least 3:1. These ratios are the baseline for readable text.
- **Flip the contrast for coloured elements.** Instead of white text on a dark colour, use dark coloured text on a light tint of that colour. Darkening a colour enough for white text to pass 4.5:1 yields heavy, attention-grabbing backgrounds that wreck hierarchy; flipping keeps the colour quiet and supportive.

  ```css
  .badge { color: hsl(220, 70%, 30%); background: hsl(220, 70%, 92%); }
  ```

- **Rotate hue for accessible coloured text.** For coloured text on a coloured background, rotate the text hue toward a brighter hue (cyan, magenta, yellow) rather than only lightening it. Lightening alone forces text near pure white to pass; a hue shift hits the ratio while staying colourful and distinct from primary text.
- **Never rely on colour alone.** Always pair colour-coded meaning with a second cue - icon, label, or shape. Colour-blind users can't decode meaning carried by colour alone, e.g. red-vs-green trends.
- **Differentiate categories by contrast.** For series like graph lines, separate them with light-vs-dark contrast rather than purely different hues. Colour-blind users discriminate lightness far more reliably than two distinct hues.
