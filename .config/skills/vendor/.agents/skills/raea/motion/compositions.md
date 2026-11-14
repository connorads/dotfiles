# Compositions: registerRoot and Composition

## What to do

- Write one file (usually `edit.tsx` at the space's root) that exports the piece's component as its default and
  ends with `registerRoot(Root)`. `Root` returns one `<Composition>` per output.
- Give each `<Composition>` an `id`, its `component`, `width`, `height`, `fps` and `durationInFrames`:
  - `id` uses letters, digits and hyphens only (no spaces, no underscores) and is unique in the root.
  - `width`, `height` and `durationInFrames` are positive whole numbers, and `fps` is a positive number.
  - `defaultProps` (optional) is a plain object of JSON values, which the component receives as its props.
- Size the composition from the shape the brief asks for: 1080x1920 (9:16), 1080x1350 (4:5), 1080x1080 (1:1) or
  1920x1080 (16:9). Use 30 fps unless the footage or brief says otherwise. Set the length as
  `Math.round(seconds * fps)`.
- Call `registerRoot` exactly once per program.
- Lay the file out the way the approved compositions do, so the next pass can find things:
  1. a header comment: what the piece is, its length in seconds and frames, its size and where its numbers come from;
  2. imports;
  3. the look, read from the brand kit (`motion/brand`);
  4. small helpers (an eased key row, `db`, seconds to frames);
  5. data: the clip list, the sound list, cue phrases;
  6. the parts, one component each, each with a one-line doc comment saying what it does;
  7. the main component, which places the clips, parts and sounds in `Sequence`s;
  8. `Root` and `registerRoot(Root)`.

## Why

The renderer finds compositions by walking the root's element tree without rendering it. It never calls a
component that uses hooks, so `Root` must just return `<Composition>` elements, with the hooks inside the
components they point at. With an id, a renderer can pick one of several compositions.
Another deliverable is its own file, NAME.tsx, rendered with `raea render NAME.tsx -o NAME.mp4`.

A root with no `<Composition>` still renders, as one composition called "main" at 30 fps and 1080x1920, lasting
until the latest end among its top-level `Sequence`s (300 frames if none has a length). Write the composition out
anyway, because a guessed size or length is how a 16:9 brief comes out vertical.

## Common mistakes

- `id="my_ad"` or `id="my ad"`: registering fails. Use `my-ad`.
- `durationInFrames={15}` meaning 15 seconds. It is frames: write `15 * 30`.
- Calling `registerRoot` twice, or once per composition. Register one root that returns several `<Composition>`s.
- A `Root` that calls `useCurrentFrame()` or `useVideoConfig()`. Hooks belong in the composition's component.
- `defaultProps` holding a function, a Date or a class instance. Only JSON values are allowed.
- Writing a second file for "the parts" and importing it. That works (modules resolve from the importing file), but
  one self-contained file is easier for the next pass to read and is how the approved pieces are written.

## Example: two shapes from one piece

```tsx
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig, interpolate } from "raea";
import { css } from "./styles.gen";

/** The end card, laid out from the frame's own width so it fits either shape. */
export default function EndCard({ line }: { line: string }) {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = width / 1080;
  const opacity = interpolate(f, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--brand-background)", justifyContent: "center", alignItems: "center" }}>
      <style>{css}</style>
      <div style={{
        width: width - 2 * 90 * u, textAlign: "center", opacity,
        fontFamily: "var(--brand-font-heading)", fontWeight: 800, color: "var(--brand-text)",
        fontSize: Math.round((height > width ? 120 : 96) * u), lineHeight: 1,
      }}>{line}</div>
    </AbsoluteFill>
  );
}

function Root() {
  return (
    <>
      <Composition id="end-9x16" component={EndCard} width={1080} height={1920} fps={30} durationInFrames={90} defaultProps={{ line: "Try it free" }} />
      <Composition id="end-16x9" component={EndCard} width={1920} height={1080} fps={30} durationInFrames={90} defaultProps={{ line: "Try it free" }} />
    </>
  );
}
registerRoot(Root);
```
