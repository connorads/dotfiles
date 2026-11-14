# Placement: Region, perception, the proof

## What to do

- Put any part that sits over a person in a `<Region name margin>`. It is an absolutely positioned box at a
  horizontal band of the frame, worked out at each frame from what perception saw:
  - `top`: from the safe top to the face's top (less the margin), or to 0.45 H with no face;
  - `bottom`: from the face's bottom (plus the margin) to the safe bottom, or from 0.55 H with no face;
  - `center`: 0.33 H to 0.67 H;
  - `full`: safe top to safe bottom;
  - `auto` (the default): the taller of top and bottom (top on a tie).

  The safe top and bottom come from perception's `safe` area. Without one they are 0.08 H, and 0.80 H on a
  portrait frame or 0.92 H on a landscape one. The box is inset across by `round(margin * width)` on each side
  (margin 0.06 by default).
- Lay the part out inside the Region with flexbox. The box has no display of its own, so give it
  `style={{display: "flex", flexDirection: "column", justifyContent: ...}}` and let the children size to it.
  `useRegion()` returns `{name, x, y, w, h}` inside it, in composition px, and the box carries `--region-width`,
  `--region-height` and, when there is a face, `--face-top`, `--face-bottom`, `--face-left` and `--face-right` as
  CSS properties.
- Size a part to its band. If the content could be taller than `useRegion().h`, shrink the type or cut words.
- Expect a band to be missing. When the band is shorter than 0.08 H (a face filling the frame), the Region
  renders nothing, and its box records why in `data-refused` ("no room top: the face leaves 120 px"). Plan for
  that beat: use the other band, a full-frame card, or no part at all.
- Keep text out of the platforms' UI zones for the shape you are making (floor). For 9:16 with the platform unknown
  that is top 220, bottom 420, right 140 and left 60 px at 1080 wide. Perception's `safe` carries the vertical zones
  when the renderer is given them (`--perception`); without it a Region falls back to 0.08 H and 0.80 H, which is
  inside the 9:16 top zone, so supply `safe` for portrait pieces. Region's side inset is the same on both sides, so pass `margin={0.13}` (140 px) when a part
  must clear the right-hand buttons.
- Use `proofBoxes({width, height, face, parts})` to check measured boxes yourself. It returns one sentence per
  problem and is empty when all is well: a part running off the frame, a part taller than its band, or a part
  covering more than 8% of the face's area. `raea check` holds the export to the face line too: given
  `--perception perception.json`, text over more than 8% of the face is a P1.

## Why

Perception gives the largest face's box for each clip (`raea cut`'s perception.json: the face at the clip's middle),
so a Region moves with the person from cut to cut. Within a clip it holds still: a lean or a punch-in isn't followed. A hand-placed `top: 300` is right for one take and covers the eyes in the next. Text over the eyes,
nose or mouth hides the most-watched part of the frame. That is a floor lint, and the proof flags it at 8%
coverage. An idea can earn an overlap (a censor-bar gag, a sticker on a shoulder). When you keep one, write the
reason in DIRECTION.md.

Platform zones say where text can't go, not where it should go. Choosing the band is a design decision, so pick
`top` or `bottom` on purpose rather than leaving everything on `auto`.

## Common mistakes

- Absolute pixel placement over footage of a person. Use a Region.
- Content taller than the band (three lines of 120 px type in a 300 px band). The proof faults it.
- Ignoring `data-refused`: the part silently doesn't appear. Check the render at each part's frames.
- Assuming `bottom` reaches the frame's edge. It stops at the safe bottom, above the platform's caption area.
- Nesting a Region inside a scaled or translated box. The band is in composition px, measured from the frame.
  Put Regions at the top of the tree (or in full-frame Sequences).
- A margin of 0.5 or more: it throws. The margin is a share of the width per side, in [0, 0.5).

## Example: a lower third that keeps clear of the face

```tsx
import { AbsoluteFill, Composition, Easing, Region, interpolate, proofBoxes, registerRoot, useCurrentFrame, useRegion, useVideoConfig } from "raea";
import { css } from "./styles.gen";

const OUT = Easing.out(Easing.cubic);

/** A name card sized to whatever band it gets: its type shrinks when the band is short. */
function NameCard({ name, role }: { name: string; role: string }) {
  const f = useCurrentFrame();
  const { h } = useRegion();
  const size = Math.min(96, Math.floor(h / 3.2));
  const y = interpolate(f, [0, 7], [30, 0], { easing: OUT, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{
      padding: "28px 40px", borderRadius: "var(--brand-radius)", backgroundColor: "var(--brand-background)",
      transform: `translateY(${y}px)`, opacity: interpolate(f, [0, 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    }}>
      <div style={{ fontFamily: "var(--brand-font-heading)", fontWeight: 800, fontSize: size, lineHeight: 1, color: "var(--brand-text)" }}>{name}</div>
      <div style={{ marginTop: 12, fontFamily: "var(--brand-font)", fontWeight: 600, fontSize: Math.round(size * 0.6), color: "var(--brand-accent)" }}>{role}</div>
    </div>
  );
}

export default function LowerThird({ name, role }: { name: string; role: string }) {
  const { width, height } = useVideoConfig();
  // the proof on a box you measured (here, a card planned at 900 x 260 in the bottom band)
  const faults = proofBoxes({ width, height, face: { x: 300, y: 520, w: 480, h: 560 }, parts: [{ name: "name card", x: 90, y: 1160, w: 900, h: 260, band: [1145, 1500] }] });
  return (
    <AbsoluteFill>
      <style>{css}</style>
      <Region name="bottom" margin={0.13} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
        <NameCard name={name} role={role} />
      </Region>
      {faults.length > 0 ? <div data-faults={faults.join("; ")} style={{ display: "none" }} /> : null}
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="lower-third" component={LowerThird} width={1080} height={1920} fps={30} durationInFrames={90}
  defaultProps={{ name: "The speaker's name", role: "Their role, as BRAND.md has it" }} />);
```

The bands come from perception.json beside the edit (`raea cut` writes it with the clips: the face at each clip's
middle, in the edit's pixels): `{"face": {"x", "y", "w", "h"}, "safe": {"top", "bottom"}}` for every frame, or such objects keyed by frame (each
one applies from its frame on). To see them, render the frame (`raea render edit.tsx --frame N -o f.png`) and look at it.
