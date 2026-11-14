# Layout and type

## What to do

- Start every scene from `<AbsoluteFill>`. It is a box over its whole parent, laid out as a flex column, and its
  `style` is merged over that. Stack things inside it with flexbox (`justifyContent`, `alignItems`, `gap`), and
  place a single part with `position: "absolute"` and `left`, `top`, `width`.
- Work in units of the frame's width. With `const u = width / 1080`, a 90 px side margin is `90 * u`, and the piece
  fits a 1920-wide landscape frame as well as a 1080-wide portrait one. For type, use the brand's size classes
  (`text-display`, `text-title`, `text-caption`, `text-body`, `text-label`), already scaled from the website's sizes
  to a 1080-wide frame (`motion/brand`).
- Give every block of text a width, a `textAlign` and a `lineHeight`. Display lines read well at a line height of
  0.92 to 1.05. Put `whiteSpace: "nowrap"` on lines that must stay on one line, and size them so they fit.
- Always set the face, from the brand: `font-brand` for display and `font-brand-body` for text. Set `fontWeight`
  explicitly too.
- Keep to the floor's sizes: at least 60 px at 1080 wide for captions and anything the viewer must read, and at
  least 32 px for small print, held long enough to read. Contrast is at least 3:1 against the pixels actually
  behind each glyph.
- Over footage, separate text from the picture on purpose: a scrim (a gradient from transparent to a dark
  translucent neutral behind the text area, as the approved reels have over their top half), a card, or a shadow
  used for separation. Don't add decoration for its own sake.
- Build cards as boxes with `boxSizing: "border-box"`, padding, `rounded-brand` and a flex
  column inside, so their content lays itself out. Animate the card's transform, and the children move with it.
- Keep what must be read inside the platform zones (`motion/placement`).

## Why

The page is laid out by a real CSS engine, so flexbox, padding and percentages behave as they do in a browser.
Absolute numbers copied from one shape break on another, while width units and flex layouts carry over.

A text block without a face comes out in the engine's default sans-serif, whatever the brand is.
If a face you named still renders as a stand-in, name it in the `font` shorthand instead
(`font: "800 96px/1 'Face Name'"`). The approved deck and game do this for a face the engine otherwise swaps.

Text that can't be read on a phone at arm's length doesn't count as being on screen, and text that runs off its
card is a defect. Both are cheaper to prevent with a width, a size and a wrap rule than to find in a render.

## Common mistakes

- No face (`font-brand`), so the text comes out in the engine's default sans-serif, not the brand's.
- Pixel positions written for 1080x1920 and reused on a 1920x1080 composition.
- Long lines with `whiteSpace: "nowrap"` and no width check: they run off the frame.
- A brand size variable used as it is (`var(--brand-h1-size)` is the website's 48 px, which is tiny on a 1080-wide
  video). Use the size classes, which scale it.
- Padding without `boxSizing: "border-box"`, so the card is wider than its `width`.
- A CSS custom property given as a number in a style object (`{"--gap": 24}`). React adds no `px` to a custom
  property, so it's a bare 24, and a length that reads it (`width: "var(--gap)"`) is invalid and drops out, as in a
  browser. Give custom properties as strings (`{"--gap": "24px"}`).
- Centring by guessing `left` values. Use a full-width box with `textAlign: "center"`, or flex centring.
- Glow, gradient text, glass panels or drop shadows as decoration. They are on the floor's refuse list.
- A lone title floating in empty space, or a pill that exists because the beat felt empty.

## Example: a headline over footage with a scrim, and a card stack

```tsx
import { AbsoluteFill, Composition, Easing, interpolate, registerRoot, useCurrentFrame, useVideoConfig } from "raea";
import { css } from "./styles.gen";

const OUT = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Three reasons, each a card that rises in 6 frames after the one before. */
export default function Reasons({ items }: { items: string[] }) {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const u = width / 1080;
  return (
    <AbsoluteFill className="bg-brand-bg">
      <style>{css}</style>
      {/* the scrim: separation for the headline if footage sits under it */}
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: 900 * u, backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)" }} />
      <div className="font-brand text-display text-brand-on-surface" style={{
        position: "absolute", left: 90 * u, top: 260 * u, width: 900 * u, textAlign: "center", fontWeight: 800, lineHeight: 0.95,
      }}>Why it works</div>
      <div style={{ position: "absolute", left: 90 * u, top: 640 * u, width: 900 * u, display: "flex", flexDirection: "column", gap: 28 * u }}>
        {items.map((text, i) => {
          const at = 6 + 6 * i;
          return (
            <div key={i} className="rounded-brand bg-brand-accent text-brand-on-accent font-brand-body text-body" style={{
              boxSizing: "border-box", padding: `${36 * u}px ${44 * u}px`, fontWeight: 700, lineHeight: 1.05,
              opacity: interpolate(f, [at, at + 5], [0, 1], clamp),
              transform: `translateY(${interpolate(f, [at, at + 6], [30, 0], { ...clamp, easing: OUT })}px)`,
            }}>{text}</div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <Composition id="reasons" component={Reasons} width={1080} height={1920} fps={30} durationInFrames={90}
    defaultProps={{ items: ["Reason one, from BRAND.md", "Reason two", "Reason three"] }} />
));
```
