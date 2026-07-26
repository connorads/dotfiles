# Dark Mode

Dark mode is a second colour system, not an inversion filter. The light-mode
palette and the light-mode depth model both break in the dark; design the dark
variants deliberately.

## Elevation

- **Elevate with surface lightness, not shadows.** Shadows barely read against
  dark backgrounds - there is nothing darker to cast onto. Signal elevation by
  making raised surfaces *lighter*: the closer to the viewer, the lighter the
  surface. Define an elevation ramp of surface colours and map it to the same
  roles the light-mode shadow scale covers (see `depth.md`'s elevation scale).

  ```css
  --surface-0: oklch(18% 0.01 255);   /* page */
  --surface-1: oklch(22% 0.01 255);   /* card */
  --surface-2: oklch(26% 0.01 255);   /* raised card, menu */
  --surface-3: oklch(30% 0.01 255);   /* dialog */
  ```

- **Keep a whisper of shadow for edges.** A tight, low-opacity contact shadow
  still helps separate overlapping surfaces; the soft ambient shadow from
  light mode is the part that dies.

## Palette

- **Build a separate dark ramp; never invert the light one.** Flipping
  `grey-100 ↔ grey-900` produces washed-out colours and broken contrast
  pairings. Re-derive each scale for dark backgrounds: desaturate large
  fills slightly (saturated colour vibrates on dark), lighten mid-tones, and
  re-run the contrast checks - AA applies in both modes.
- **Avoid pure black backgrounds.** Same instinct as avoiding `#000` text in
  light mode: start the page surface at a very dark grey so elevation has
  room to go darker *and* lighter, and smearing/halation on OLED is reduced.

## Text

- **Secondary text is lower lightness, same hue - not opacity.** On dark
  surfaces, semi-transparent white picks up the surface colour behind it and
  goes muddy over images or tinted panels. Step secondary/tertiary text down
  the same-hue lightness ramp instead, and check each level's contrast on the
  surface it actually sits on.
- **Dial type weight down a notch.** Light-on-dark text blooms (halation), so
  the same font reads heavier than dark-on-light. Where the light theme uses
  medium, dark often wants regular.
