# Compositions: registerRoot and Composition

## What to do

- Write one file (usually `edit.tsx` at the space's root) that exports the piece's component as its default and
  ends with `registerRoot(Root)`. `Root` returns one `<Composition>` per output.
- Give each `<Composition>` an `id`, its `component`, `width`, `height`, `fps` and `durationInFrames`:
  - `id` uses letters, digits and hyphens only (no spaces, no underscores) and is unique in the root.
  - `width`, `height` and `durationInFrames` are positive whole numbers, and `fps` is a positive number.
  - `defaultProps` (optional) is a plain object of JSON values, which the component receives as its props.
  - `controls` (optional) says which of those props a person may tune: see "Controls" below.
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

## Controls: anything a person might tune

Anything a person might tune goes in `controls`: a colour, a warmth, a speed, a size, a title's words, which model
or take is used, whether it rains. Make it a prop with its value in `defaultProps`, read it in the component (as a
prop, or with `useControl("name")` in a part deep in the tree), and declare it in `controls` by the same key. The
feed's Controls panel lists them beside the timeline, and moving one changes the live picture at once, then the
render around it; a value written in the middle of the code is one the person can only ask you to change.

- Each control names a `defaultProps` key, and its `kind` fits that value: `number` (with `min`, `max`, `step` and
  `unit` when it has a range), `switch` (true or false), `choice` (one of `options`), `colour` (a hex string,
  `"#rgb"` to `"#rrggbbaa"`) or `text` (`maxLength`, `multiline`). The registry refuses one that doesn't fit, naming
  the control.
- `group` puts related controls together ("Grade", "Camera", "Words"); `label` and `about` are what the panel shows.
- `cost` says how a change reaches the picture. `live` (the default) is drawn at once, for values the running world
  takes frame by frame: a place, a turn, a size, a colour, roughness and metalness, a glow, opacity, a light's
  strength, the camera, any 2D style or text. `reopen` is for what a 3D world keeps from its first frame: a shape's
  geometry, a model's file, an instance count, a picture map, a shader. `resim` is for state carried from frame to
  frame: physics, particles, a game's fold.

```tsx
<Composition id="mayor" component={Film} width={1920} height={1080} fps={30} durationInFrames={2700}
  controls={{
    warmth: { kind: "number", min: -1, max: 1, step: 0.05, group: "Grade" },
    model: { kind: "choice", options: ["goose", "mayor"], cost: "reopen" },
    rain: { kind: "switch", cost: "resim" },
    title: { kind: "text", maxLength: 40, group: "Words" },
  }}
  defaultProps={{ warmth: 0.2, model: "goose", rain: false, title: "Swamp-Side Mayor" }} />
```

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
- A tunable value as a literal in a part (`const WARMTH = 0.2`, `color="#d04a3a"` in a mesh): the person can't move
  it. Make it a prop in `defaultProps` and a control.
- A control for a key `defaultProps` doesn't have, or a `number` control whose value is outside its `min` and `max`:
  registering fails, naming the control.
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

/** What a person may tune: the line's words. */
const controls = { line: { kind: "text", maxLength: 32, group: "Words" } } as const;

function Root() {
  return (
    <>
      <Composition id="end-9x16" component={EndCard} width={1080} height={1920} fps={30} durationInFrames={90} defaultProps={{ line: "Try it free" }} controls={controls} />
      <Composition id="end-16x9" component={EndCard} width={1920} height={1080} fps={30} durationInFrames={90} defaultProps={{ line: "Try it free" }} controls={controls} />
    </>
  );
}
registerRoot(Root);
```
