# raea

A composition is a React component that is rendered once per frame. Every frame is worked out from the frame number
alone, with nothing carried over between frames. The engine decodes the footage, paints the page, draws the 3D
and mixes the sound, so your job is to say what each frame looks and sounds like.

Write it in the object's own files: edit.tsx, cuts.ts (`raea cut` writes it) and components/ (`raea part add` copies
parts in). AGENTS.md lists the whole API. These files say how to use it well.

## Which file to read

Read the files a task needs with `raea guide motion/NAME`, one or two at a time, and drop them when you move on.

| You are... | Read |
|---|---|
| starting a file, sizing it, picking compositions | `motion/compositions` |
| deciding when things happen, cutting into scenes | `motion/timing` |
| moving anything: entrances, exits, counters, push-ins | `motion/animating` |
| cutting takes, framing a face, trimming, clip sound | `motion/footage` |
| music beds, foley, gains, fades, the master | `motion/sound` (the music itself: `motion/music`) |
| captions, or anything cued to what someone says | `motion/words` |
| putting parts over a face, platform zones, the proof | `motion/placement` |
| cards, stacks, type sizes, fonts | `motion/layout` |
| colours, faces and sizes from the brand | `motion/brand` (every piece needs it) |
| media files, logos, generated sound, imports | `motion/assets` |
| meshes, lights, cameras, modelled solids | `motion/3d`, then `bevy` (the 3D library: lights, materials, models, effects, 3D games) |
| input, rules, scores, sound on game events | `motion/games` |
| rendering stills or the video, and checking them | `motion/rendering` |
| the shapes, lengths and platforms it ships to, the files, posting deliverables | `motion/delivery` |
| an app's interface (its own window, not a composition): every state, built and checked by walking it | `motion/interface` |

## The core rules

1. **Frames, not seconds.** `useCurrentFrame()` is the frame counted from the start of the nearest `Sequence`, and
   time is `frame / fps`. Convert seconds once with `Math.round(s * fps)`. Media trims (`startFrom`, `endAt`) are
   in source frames at the composition's fps.
2. **Frame-pure.** The renderer can ask for any frame in any order, so derive everything from the frame number.
   `useState`, `useEffect` and timers don't animate a render. `Math.random()` is seeded for each frame: a render
   repeats, but every frame draws new numbers, so it suits grain or a flicker, and something that should hold still
   (a scatter, a layout) is seeded from an index. `Date` (`Date.now()`, `new Date()`) is the frame's time.
3. **Clamp every interpolate.** The default extrapolation extends the line forever, so use
   `{extrapolateLeft: "clamp", extrapolateRight: "clamp"}` unless you mean otherwise. Inputs must strictly increase.
4. **Settle with `Easing.out(Easing.cubic)`.** The plain curves (`Easing.cubic`, `Easing.quad`) ease in, and
   `Easing.ease` is an ease-in too. Don't reach for bounce or elastic by reflex.
5. **Cue on words, not on guessed frames.** `word("phrase")` returns the frame where the phrase is said, and
   `useWords()` gives the words that captions are built from. `raea render` passes the cut's words.json for you.
6. **Place from perception.** Put text over a person in a `<Region>`, which keeps clear of the face and inside the
   platform's safe area. `raea check --perception perception.json` flags text over more than 8% of the face.
7. **Theme from the brand.** `<style>{css}</style>` (from `./styles.gen`, which `raea render` writes from
   brand/brand.css) loads the brand's variables and the project's Tailwind. Style with the brand classes
   (`text-brand-accent`, `bg-brand-surface`, `font-brand`, `text-title`, `rounded-brand` and the rest in AGENTS.md),
   or `var(--brand-*)` where a class can't reach. Never write a hex palette of your own. A role the kit leaves empty
   is yours to decide from the brand's own colours (`motion/brand`).
8. **Sound is part of the edit.** Each sound goes in its own `<Sequence from layout="none">`. Use `gainDb` for
   levels, Tone.js for music (`motion/music`: TokenSynth or sample-library instruments in a Sampler) and `sao()` for
   foley, and put one `<Mix lufs={-14} />` in the composition. Put the sounds in the tree in time order.
9. **Keep animated styles present on every frame.** The engine keeps a style property that React stops sending.
   Write `transform: scale(1)` and `opacity: 1` rather than leaving them out when an animation settles. Always set
   `fontFamily`, because the engine's default face is a serif.
10. **Render it and look.** `raea check` measures the export (`motion/rendering`); `raea render edit.tsx --at 15,63,144 -o stills/` renders the frames that matter (each cut,
    each entrance, the hook at 0.5 s, the end card) to look at. Look at the stills in one batch, fix everything they
    show, then look again.

The craft rules decide what the piece should be (the router and the floor). These files say how to write it. When
a floor lint flags something you keep on purpose, write the reason in DIRECTION.md. Defects (a clipped word,
unreadable text, the wrong loudness) and bans (invented claims, generated imagery, redrawn logos) always win.

## A whole composition, small

```tsx
import { AbsoluteFill, Composition, Easing, Mix, Sequence, Audio, interpolate, registerRoot, sao, useCurrentFrame, useVideoConfig } from "raea";
import * as Tone from "raea/tone";
import { css } from "./styles.gen";

// the bed: one TokenSynth instrument in a Sampler, a bar of notes on a loop (motion/music)
const keys = new Tone.Sampler({ urls: Tone.tokensynth("a soft felt piano, warm, intimate", ["C3", "C4"], { seconds: 2 }), volume: -14 }).connect(Tone.buses.music);
new Tone.Sequence((t, n) => keys.triggerAttackRelease(n, "4n", t), ["C4", "G3", "E4", "G3"], "4n").start(0);
Tone.getTransport().start();
const WHOOSH = sao("soft airy whoosh, short, clean, no music", { seconds: 0.8 });

const OUT = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Title({ text }: { text: string }) {
  const f = useCurrentFrame();
  const y = interpolate(f, [0, 8], [40, 0], { ...clamp, easing: OUT });
  const opacity = interpolate(f, [0, 6], [0, 1], clamp);
  return (
    <div style={{
      position: "absolute", left: 90, right: 90, top: 760, textAlign: "center",
      lineHeight: 1, fontWeight: 800, transform: `translateY(${y}px)`, opacity,
    }} className="font-brand text-display text-brand-on-surface">{text}</div>
  );
}

export default function Piece() {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill className="bg-brand-bg">
      <style>{css}</style>
      <Sequence from={0} durationInFrames={2 * fps} name="title"><Title text="Ship it" /></Sequence>
      <Sequence from={0} name="whoosh" layout="none">
        <Audio src={WHOOSH} gainDb={-18} />
      </Sequence>
      <Mix lufs={-14} ceiling={-1.5} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="piece" component={Piece} width={1080} height={1920} fps={30} durationInFrames={90} />);
```
