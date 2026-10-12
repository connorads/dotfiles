# Thread-header chips share one workspace package

Every plugin that adds a thread-header action draws it with
[`@bb-plugins/chip`](../../chip/README.md): one anatomy (28 px tall, 8 px radius,
12 px/500 type, muted chrome), one value in foreground colour, and status hue
only on a dot, an icon or a figure. Plugins depend on it with `workspace:*`.

## Context

BB lays plugin header actions side by side in one bar, sorted by plugin id. Each
plugin copied git-glance's chip CSS by hand. An audit found seven copies and
drift in all of them:

- three heights (about 25 px, 28 px and a wrapping 26 px line);
- 6 px and 8 px radii; no border on one chip; a filled background on another;
- no font set on one chip, so it inherited a larger host size;
- hex colours in one chip and `oklch` literals in another, where theme tokens
  exist;
- hover, press and focus states on some chips and not others.

## Decision

- `chip/` holds `Chip`, `ChipValue`, `ChipDot` and `chip.css`. A plugin that
  needs only the anatomy, such as a non-interactive status chip or a chip with
  several icons, uses the `bbp-chip*` classes and imports the package for its
  CSS.
- `bb plugin build` bundles the package's JS and CSS into each plugin's
  `dist/app.js` and `dist/app.css`. A built plugin needs nothing from the
  workspace at run time.
- The package ships no icons. BB's built-in names cover most chips. A plugin
  that needs a glyph BB lacks draws it locally.

## Alternatives considered

- **Keep per-plugin copies.** This produced the seven drifted copies above.
  No review step caught the drift.
- **Keep a written spec and lint each plugin's chip CSS against it.** The lint
  would flag drift after it happened, and seven copies would still need the
  same edit for every change.
- **Use a host chip component.** Plugin SDK 0.6.37 exports `experimental_Icon`
  and slot props, but no chip or button primitive.

## Consequences

- Plugin stylesheets are global. Every plugin carries a copy of the `bbp-chip`
  rules, and the copy loaded last wins. After a change to `chip/`, rebuild and
  reload every plugin that imports it.
- A plugin submitted to the marketplace on its own needs the package beside it.
  Vendor `chip/` into that plugin's source, or publish it, before submission.
  The built `dist/` already holds everything it needs.
