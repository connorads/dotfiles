# Animating

## What to do

- Animate text and graphics with declared moves, not per-frame maths. Wrap the part in `<Animate>` and name its
  entrance: `<Animate enter="rise" at={word("crack")}>`. The engine samples it in Rust on every frame, so a render, live
  play and a seek all agree, and nothing hard-cuts.
- Start from the named moves. Their defaults are the timings the approved pieces were measured to use:
  - `rise`: y 30 px to 0 over 6 frames, out-cubic, fading in over 5;
  - `pop`: scale 0.6, then 1.08 at frame 4, then 1 at frame 8;
  - `slam`: scale 1.3, then 0.96 at frame 4, then 1 at frame 8, for a hit;
  - `slide`: 30 px from a side over 7 frames (a card arriving);
  - `wipe`: a clip reveal over 8 frames, in-out-cubic;
  - `fill`: width 0 to 100% over 24 frames, for a bar starting as the number is said;
  - `tick({ to })`, called with where it ends (`enter="tick"` alone throws): a number counting up over 24 frames,
    written as the element's text. It's hidden until its `at` and fades in over 2 frames (`fade: 0` shows it
    at `from` the whole time). `digits: 2` for decimals, `separator: ","` (or `true`) for 12,345, and
    `prefix: "$"`, `suffix: " pts"` keep the sign and unit in the same text (write a
    non-breaking space as `" pts"` in braces, `suffix={" pts"}`, never in a plain JSX attribute string);
  - `strike`: a line drawn 0 to 100% over 8 frames;
  - `pushIn`: scale 1 to 1.04 across 90 frames, linear, on footage;
  - `fade`: opacity 0 to 1 over 6 frames.
- Tune a move rather than inventing one: `rise({ distance: 40, frames: 10, ease: "out-quint" })`,
  `pop({ peak: 1.12 })`, `slide({ from: "right", distance: 64 })`. Vary moves by the part's role, because one move
  everywhere is a lint.
- Give anything that leaves an exit: `exit="fade" exitAt={90}`. The exit is the move played backwards, so it leaves
  the way it came, with the matching in-curve.
- For anything the moves don't cover, key it yourself with `track`: `animate={{ backgroundColor: track({ 0: "#fff",
  12: "#ffd400" }) }}`. A track takes numbers or colours (CSS variables work), one curve or one per segment, and
  `{ repeat: "loop" }`. Keyable properties are `opacity`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotate`, `width`,
  `height` (with `{ unit: "%" }`), `clipTop`, `clipRight`, `clipBottom`, `clipLeft`, `blur`, `text`, colours and any
  numeric style.
- Curves are names: `out-cubic` (the settling default), `in-out-cubic` (between two resting places), `in-cubic`
  (leaving), `linear` (constant motion), `curve.bezier(...)`, and `curve.spring({ damping: 15, stiffness: 120 })`,
  which stretches a spring over its segment so it lands on the next key.
- Order several parts with a timeline instead of hand-adding frame offsets: `timeline(sequence(["card", "rise"],
  parallel(["title", "pop"], ["cta", "fade"])))`, then `<Animate timeline={plan} part="title">`. Use
  `<Stagger each={3} enter="rise">` for a list; `grid={{ cols: 3, from: "center" }}` spreads it from the middle.
- Declare once. Put moves, tracks and plans at module level, or in `useMemo` when they depend on props, never as new
  objects built inside a component on every frame.
- Keep `interpolate` and `spring` for values that aren't style on one element: a sound's volume, a number fed into
  layout, a value the code branches on.

## Why

A hand-written `interpolate` per property invites made-up numbers: a badge sliding 64 px in 8 frames on an invented
bezier, a caption chip that switches colour in one frame, a box that changes size because its scale and its content
are computed separately. A named move carries a measured timing, its exit mirrors it, and the engine evaluates it from
the frame number, so a frame looks the same however you got to it.

`at` and `exitAt` count in the frames of the nearest enclosing `<Sequence>`, like `useCurrentFrame()`, not from the
parent `<Animate>`. A counter inside a badge that enters at frame 110 starts at `at={124}`, not `at={14}`, unless the
badge is inside its own Sequence.

An `<Animate>` stays in the layout from the start, invisible until its entrance fades it in, so the boxes around it
don't jump when it arrives. Use `mount="during"` when it should only take its space while it shows (a list that grows
as replies land).

Bounce and elastic curves by reflex are on the floor's refuse list. Use them only when the idea is literally bouncy.

## Common mistakes

- A counter or chip whose `at` was counted from its parent `<Animate>` instead of its Sequence: it finished before
  the part arrived.
- `exit` without `exitAt`: it throws.
- Tracks built inline in a component on every frame (`animate={{ y: track(...) }}` inside a big list): hoist them.
- A curve name that doesn't exist (`"outCubic"`): the engine logs it once and the track doesn't play. Use the
  kebab-case names above.
- An entrance in CSS `@keyframes` instead of a move. CSS animations do run, on the frame clock from their
  Sequence's start (a `1s linear` grow is exactly half way at frame 15), but they can't land on a word (`at`) or
  carry a measured timing and its mirrored exit.
- `Math.random()` for an offset that should hold (a jittered layout). It's seeded per frame, so every frame draws new
  values and the parts shake. Seed from the index:
  `const x = Math.sin(i * 12.9898) * 43758.5453; const r = x - Math.floor(x);`.
- The same pop on every part.

## Example: a stat card that lands, counts up and fills its bar, then leaves

```tsx
import { AbsoluteFill, Animate, Composition, fill, pop, registerRoot, rise, tick, timeline, sequence, parallel } from "raea";
import { css } from "./styles.gen";

// declared once: the card rises, then the number pops and counts while the bar fills, then the label fades in
const plan = timeline(sequence(
  ["card", rise({ distance: 30, frames: 7 })],
  parallel(["number", pop()], ["bar", fill({ to: 73, frames: 24 })], { part: "label", move: "fade", offset: 6 }),
));
const COUNT = tick({ to: 73, frames: 24 });

export default function Stat({ label = "of tests ship" }: { label?: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--brand-background)" }}>
      <style>{css}</style>
      <Animate timeline={plan} part="card" exit="rise" exitAt={52} style={{
        position: "absolute", left: 90, top: 640, width: 900, height: 460, boxSizing: "border-box", padding: 56,
        borderRadius: 44, backgroundColor: "var(--brand-accent)",
      }}>
        <Animate timeline={plan} part="number" style={{ display: "flex", fontFamily: "var(--brand-font-heading)", fontWeight: 800, fontSize: 220, lineHeight: 1, color: "var(--brand-background)", transformOrigin: "0% 50%" }}>
          <Animate as="span" enter={COUNT} at={7} />%
        </Animate>
        <Animate timeline={plan} part="label" style={{ marginTop: 16, fontFamily: "var(--brand-font)", fontWeight: 700, fontSize: 64, color: "var(--brand-background)" }}>{label}</Animate>
        <div style={{ position: "absolute", left: 56, right: 56, bottom: 56, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.18)", overflow: "hidden" }}>
          <Animate timeline={plan} part="bar" style={{ height: 28, borderRadius: 14, backgroundColor: "var(--brand-background)" }} />
        </div>
      </Animate>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="stat" component={Stat} width={1080} height={1920} fps={30} durationInFrames={60} />);
```
