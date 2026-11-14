# Brand: the brand classes, brand.css variables, roles from brand.json

Every piece takes its look from the brand kit in its object. `raea brand DOMAIN` writes the kit (run it first when the brief
names a brand and the object has no BRAND.md). It reads the brand's website on this machine: the HTML and its CSS,
without running the site's scripts. Nothing in the kit is invented: a role that no brand colour fills legibly is left
empty for you to decide.

## When the fetch was thin

A site drawn by JavaScript, or one whose theme is set by script, shows a plain fetch little. Then `raea brand` prints a
WARNING and BRAND.md opens with "The fetch was thin", saying what was missing; a site with nothing readable refuses.
Don't style from that kit as it is. Open the site in your own browser tool (a fetch or browser tool, devtools, a
browser MCP) and read the live page:

- the computed `background-color` and `color` of `body`, and of the main call-to-action button;
- the computed `font-family`, `font-size` and `font-weight` of the `h1` and of body text;
- the logo (an `<svg>` or `<img>` in the header): save it in `media/brand/`;
- a screenshot of the hero, to check the colours you picked are the ones a visitor sees.

Write what you found into `brand/brand.json` (`palette`, `fonts`, `logos`) and `brand/brand.css` (the `--brand-*`
variables), and record each value you set by hand in brand.json's `source.by_hand`, with where it came from:
`{"palette.accent": "computed background of the hero button"}`. A size brand.css marks "not on the site: raea's
default" is a stand-in; replace it if the live page shows the real one.

## The kit

- `brand/brand.css`, the brand's stylesheet. Its `:root` sets `--brand-*` variables:
  - colours: `--brand-<name>` for each of the site's working colours (usually `--brand-accent`,
    `--brand-background` and `--brand-text`) and `--brand-color-1`, `--brand-color-2` and so on for the palette,
    most prominent first;
  - faces: `--brand-font-heading` and `--brand-font` (full font stacks);
  - the type scale: `--brand-h1-size`, `--brand-h1-weight`, `--brand-h1-line`, `--brand-h1-tracking`, the same for
    h2 and the other levels, and `--brand-p-*` for body text. These are the website's sizes;
  - spacing, shadows and corners: `--brand-space-xs` to `-xl`, `--brand-shadow-sm` to `-xl`, `--brand-radius`;
  - classes: `.brand-h1` and the other levels, `.brand-text`, `.brand-button` and `.brand-card`.
- `brand/brand.json`, the same kit read by role:
  - `palette`: `primary`, `accent` (the same as `--brand-accent`), `surface` (`--brand-background`),
    `text_on_surface` (`--brand-text`) and `text_on_accent`. Any of them can be `null`;
  - `contrast`: the measured ratios of text_on_surface, text_on_accent and accent_on_surface;
  - `colors`: every colour as `{name, hex, css}`, where `css` names its variable;
  - `fonts`, `scale`, `button`, `radius`, `shadow`;
  - `logos`: each logo's `file` (in `media/brand/`), `type`, and `on` (the background it is for: `light`, `dark`
    or `any`).
- `BRAND.md` holds the same facts for you to read, plus the voice and the allowed claims.

## What to do

- Load the styles once, at the top of the main component: `import { css } from "./styles.gen"` and
  `<style>{css}</style>`. `raea render` (and `play` and `bundle`) writes styles.gen.ts from
  brand/brand.css and the Tailwind classes the project uses, so a refreshed kit restyles the piece without edits.
- A face the kit names but this Mac doesn't have: put its files in `media/fonts/` and declare each with `@font-face`
  in brand/brand.css (or a `<style>`), its `src` the file's path: `src: url("media/fonts/Sohne-600.woff2")`
  (relative to the edit), `url("/media/fonts/Sohne-600.woff2")`, or `url(${staticFile("fonts/Sohne-600.woff2")})`
  in a template string. woff2, woff, ttf and otf load; one rule per
  weight and style. Then name the family in `--brand-font-heading` / `--brand-font`. No base64 is needed, though a
  `data:` URL works too.
- Style with the brand classes. Colour: `text-brand-accent`, `bg-brand-accent`, `bg-brand-surface` (or `bg-brand-bg`),
  `text-brand-on-surface`, `text-brand-on-accent`, `text-brand-ink`, and `brand-1`, `brand-2`, `brand-3` for the
  palette. Faces: `font-brand` (display) and `font-brand-body` (text). Sizes: `text-display`, `text-title`,
  `text-caption`, `text-body`, `text-label`, already scaled from the website's sizes to a 1080-wide frame. Corners:
  `rounded-brand`.
- Where a class can't reach (a computed gradient, a value inside `interpolate`), use the variables:
  `var(--brand-accent)`, `var(--brand-background)`, `var(--brand-text)`, `var(--brand-color-2)`,
  `var(--brand-font-heading)`. Use the brand's weights and line heights (`var(--brand-h1-weight)`).
- Use the roles for pairings. Text on the accent uses `text-brand-on-accent`. Respect the contrast notes in
  `brand.json`: when accent_on_surface is under 3, don't set accent text on a surface card.
- When a role is `null`, decide it yourself from the brand's own colours, check it reaches 3:1 against what sits
  behind it, and write the choice in DIRECTION.md in one line.
- When a value has to be a plain colour string (a 3D material), read it from `brand.json`
  (`import kit from "./brand/brand.json"`), never from a literal.
- Use the real logo files from `media/brand/` (`kit.logos`), picking the one whose `on` matches the background it sits
  on. Never redraw a logo.
- The person and BRAND.md win over your taste. A colour or face they asked for beats the kit's default pick.

## Why

A palette typed into the file makes every brand look like the last one, and it is how a piece lands in one of the
floor's four generated looks without anyone deciding. The kit holds the brand's own colours picked by contrast,
its faces and its sizes, so reading it keeps the piece the brand's and lets a refreshed kit restyle the piece
without edits. The same `brand.css` themes raea's components, so a piece, a part and a page agree.

## Common mistakes

- `const LIME = "#c8ff2e"` or any palette constant of your own. Use `text-brand-accent`, or `kit.palette.accent`
  where a string is required.
- Forgetting `<style>{css}</style>`: no class or variable resolves, and the frame comes out unstyled.
- `var(--brand-h1-size)` used as a size: the website's size is tiny on video. Use the size classes.
- Assuming a variable exists. Names come from the site's tokens, so check `brand.json`'s `colors` for what this kit
  has before writing `var(--brand-muted)`.
- Accent text on a surface the kit says it fails on.
- A dark-background logo on a dark card.

## Example: a brand end card built from the kit alone

```tsx
import { AbsoluteFill, Composition, Img, interpolate, registerRoot, staticFile, useCurrentFrame } from "raea";
import { css } from "./styles.gen";
import kit from "./brand/brand.json";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
// a logo for any background, else the first; on a known light or dark ground, match `on` to it instead
const LOGO = kit.logos.find((l) => l.on === "any") ?? kit.logos[0];

export default function EndCard({ cta }: { cta: string }) {
  const f = useCurrentFrame();
  const pop = interpolate(f, [8, 12, 16], [0.6, 1.08, 1], clamp);
  return (
    <AbsoluteFill className="bg-brand-bg" style={{ justifyContent: "center", alignItems: "center", gap: 60 }}>
      <style>{css}</style>
      {LOGO ? <Img src={staticFile(LOGO.file.replace(/^media\//, ""))} style={{ height: 160, opacity: interpolate(f, [0, 8], [0, 1], clamp) }} /> : null}
      <div className="rounded-brand bg-brand-accent text-brand-on-accent font-brand text-title"
        style={{ padding: "36px 72px", fontWeight: "var(--brand-h1-weight)", lineHeight: 1, transform: `scale(${pop})` }}>{cta}</div>
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <Composition id="end-card" component={EndCard} width={1080} height={1920} fps={30} durationInFrames={75} defaultProps={{ cta: "Start free" }} />
));
```
