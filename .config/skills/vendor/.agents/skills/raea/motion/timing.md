# Timing and frames

## What to do

- Think in frames. Frames are whole numbers from 0, and frame `t` is `t / fps` seconds. Read `fps`, `width`,
  `height` and `durationInFrames` from `useVideoConfig()` and turn seconds into frames once, with
  `Math.round(s * fps)`.
- Give every part its own `<Sequence from durationInFrames name>`. Inside it, `useCurrentFrame()` counts from 0 at
  the Sequence's start, and the children only exist while `from <= frame < from + durationInFrames`. So a part can
  write its entrance as "frames 0 to 8" wherever it sits.
- Name every Sequence (`name="hook"`, `name="clip c3"`). The name only labels it in tools, but it is what a critique,
  a refine pass and the renderer's report will call it.
- When a part needs composition frames (for a cue from `word()`, which returns composition frames), pass the
  Sequence's `from` in as a prop and add it: `const f = useCurrentFrame() + from`. The approved pieces do this.
- Use `<Series>` for scenes that play back to back. Each `<Series.Sequence durationInFrames offset?>` starts where
  the one before ended. A positive `offset` leaves a gap, and a negative one overlaps the scene before (for a
  crossfade or a wipe). Only the last one may have no length.
- Use `<Loop durationInFrames times?>` for a cycle (a pulsing dot, a ticker) and `<Freeze frame>` to hold a subtree
  at one frame (a still from an animation, or a paused screen).
- Use `layout="none"` on a Sequence that only times something and draws nothing, such as an `<Audio>`. The default
  layout wraps the children in a full-frame box, and later Sequences paint over earlier ones.

## Why

The renderer can render any frame on its own, in any order, so a part has to know where it is from the frame alone.
Sequences make that local. Offsets add up through nesting: a Sequence `from={60}` inside one `from={30}` starts at
composition frame 90. An inner Sequence is also cut off by its outer one, so a part never outlives its slot.

Time in a short piece is tight. The floor asks for the hook on screen and in the ear by 0.5 s (frame 15 at 30 fps),
about 0.3 s per word for anything the viewer must read, and at least 1 s for any line. Plan in frames from those
numbers.

## Common mistakes

- Mixing seconds and frames: `from={2.5}` is not 2.5 seconds. Write `from={Math.round(2.5 * fps)}`.
- Fractional frames from arithmetic (`from={total / 3}`). Round them.
- Using a cue frame from `word()` inside a Sequence without adding `from`. `word()` is composition time, while
  `useCurrentFrame()` inside the Sequence is local.
- `durationInFrames={0}` renders nothing, and a negative length throws.
- A child of `<Series>` that isn't a `<Series.Sequence>`: Series throws. Wrapping them in fragments is fine.
- `style` or `className` on a `layout="none"` Sequence: it throws, because there is no box to style.
- A part that keeps a value in `useState` between frames. Nothing carries over; compute it from the frame.

## Example: three scenes back to back, the last overlapping

```tsx
import { AbsoluteFill, Composition, Sequence, Series, Loop, registerRoot, useCurrentFrame, useVideoConfig, interpolate } from "raea";
import { css } from "./styles.gen";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A full-frame scene that fades in over its first 8 frames. */
function Scene({ label, tone }: { label: string; tone: string }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: tone, justifyContent: "center", alignItems: "center", opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
      <div style={{ fontFamily: "var(--brand-font-heading)", fontWeight: 800, fontSize: 140, color: "var(--brand-text)" }}>{label}</div>
    </AbsoluteFill>
  );
}

/** A dot that pulses once a second. */
function Pulse() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = interpolate(f, [0, fps / 2, fps], [1, 1.3, 1], clamp);
  return <div style={{ position: "absolute", left: 510, top: 1500, width: 60, height: 60, borderRadius: 30, backgroundColor: "var(--brand-accent)", transform: `scale(${s})` }} />;
}

export default function Scenes() {
  const { fps } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--brand-background)" }}>
      <style>{css}</style>
      <Series>
        <Series.Sequence durationInFrames={sec(1.5)} name="one"><Scene label="One" tone="var(--brand-background)" /></Series.Sequence>
        <Series.Sequence durationInFrames={sec(1.5)} name="two"><Scene label="Two" tone="var(--brand-accent)" /></Series.Sequence>
        {/* starts 8 frames before "two" ends, so its fade covers the join */}
        <Series.Sequence durationInFrames={sec(2)} offset={-8} name="three"><Scene label="Three" tone="var(--brand-background)" /></Series.Sequence>
      </Series>
      <Sequence from={sec(3)} name="pulse">
        <Loop durationInFrames={fps}><Pulse /></Loop>
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="scenes" component={Scenes} width={1080} height={1920} fps={30} durationInFrames={142} />);
```

## Pacing cuts to a song's energy

This is standard procedure for any music-led piece. Before cutting anything to a song, map it
(`raea song song.wav --plot song.song.png`) and look at the plot. Time every cut, slam and move from the
map's beats, downbeats and events, never from a constant BPM: `n * 60 / bpm` drifts off the real beats within a
minute (a tempo read off quantised beat gaps can be 2% out: 129.2 for a song at 132.2), and it can't see a build, a
stop or a drop. A song's beats say where a cut can land; its energy says how often one should:

- Hold in low sections (a cut every two or four bars), cut on the bar in the middle, on the half bar or the beat where
  the energy is high. `song(map, { fps }).cutsAt()` gives these frames from each section's suggested rate.
- Through a build, cut faster as it rises (cutsAt doubles the rate in a build's second half); `useSong(map).buildProgress`
  can drive a push-in or a zoom over the same span.
- Put the biggest change of the piece (a new scene, the title, a colour flip) on the drop. A drop with `holds: false`
  is one hit and then the band cuts out: cut on it, then let the shot sit or cut only on the stop's hits.
- A stop (the beat drops out, a few hits left) is the "riser… beat, beat… drop" moment: cut on each of its `hits`,
  and nothing between them.
- Loudness alone misleads: a chorus often opens quieter than the pre-chorus before it. Trust the events, and check the
  plot against the song.

```tsx
import map from "./song.song.json";
import { Sequence, song, useVideoConfig } from "raea";

function Cuts({ shots }: { shots: React.FC[] }) {
  const { fps } = useVideoConfig();
  const cuts = song(map, { fps, offset: 41.9 }).cutsAt({ from: 0, to: 30 * fps });
  return <>{cuts.map((from, i) => {
    const Shot = shots[i % shots.length];
    return <Sequence key={from} from={from} durationInFrames={(cuts[i + 1] ?? 30 * fps) - from}><Shot /></Sequence>;
  })}</>;
}
```
