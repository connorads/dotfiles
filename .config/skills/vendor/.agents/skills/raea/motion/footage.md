# Footage: Video, framing, trims, fades, gainDb

## What to do

- The clips are data in cuts.ts: `raea cut` writes each one's take, `src`, `from` and `to` (seconds in the take,
  cut in the pauses between words) and `line`, and `frames(c)` gives its length in the edit's frames. Render each clip
  in its own `<Series.Sequence durationInFrames={frames(c)}>` (or `<Sequence from durationInFrames name>`) so it
  starts at its own frame 0. Re-run `raea cut` to change the clips rather than editing the seconds by hand.
- Trim with `startFrom` and `endAt`. Both are **source frames at the composition's fps**, so a clip that starts 12.4 s
  into the take has `startFrom={12.4 * fps}` and, for a clip `dur` frames long, `endAt={startFrom + dur}`. The source
  time shown at the clip's frame `f` is `(startFrom + f * playbackRate) / fps`. `trimBefore` and `trimAfter` are other
  names for the same two props: use one name or the other, never both.
- Frame a talking head on its face. `raea frame TAKE` says whether the take is a talking take (`<FaceFrame>`, from
  `raea part add face-frame`) or a wide screen recording (`<ScreenFit>`). `<FaceFrame src={take} />` (or
  `<Video framing="face">`) has the engine find the face and keep the eyes 38% down the frame as the speaker moves; an
  objectPosition or transform of your own on that Video turns the framing off. Zoom a clip for emphasis with
  `punchIn={1.15}`. Alternating punched and unpunched clips between cuts gives a talking head rhythm without a zoom
  on every sentence. The face track comes from raea-perceive (the render is refused without it, or with no face found)
  and is kept beside the take as TAKE.faces.json, so a second render reads it.
- For a slow push-in, or for footage without a face (a screen recording, a product shot), set the fit yourself:
  `objectFit: "cover"` (the default), `objectPosition` to choose which part of the overflow stays, and
  `transform: scale(z)` to zoom about the box's centre. An explicit `objectPosition` or scale wins over `framing`.
  Wrap the Video in a box with `overflow: "hidden"`.
- Give each clip's sound a level and clean joins: `gainDb` (or `volume`, a linear gain where 1 is unity), and
  `fadeIn` and `fadeOut` in seconds. A fade of 0.012 s at every cut removes the click at a join. Fades run at the
  audio's own rate, so they can be shorter than a frame.
- Use `muted` for picture-only clips, `playbackRate` for speed changes (the sound follows) and `loop` with `endAt` to
  repeat a short source from `startFrom` each time it reaches `endAt` (without `endAt`, nothing loops).
- Use `<Img src>` for stills. The frame waits until the image has loaded. An image whose file isn't there fails the
  render with "missing image: PATH"; a plain App prints that line and draws nothing.

## Why

The renderer decodes the exact source frame for every rendered frame, so there is no drift to correct and no
preloading to manage. That only works if the trims mean what you think: `startFrom` in seconds puts the clip 30
times too early, and an `endAt` measured from the clip's start ends it at once.

Past `endAt` (or the source's end) a Video holds its last frame and Audio goes silent. A clip whose Sequence is
longer than its trim shows a frozen picture, which is a floor defect (frozen or hung frames).

The cut is the edit's most important decision. The floor's first defect is a cut inside a word or on a breath, so
take the in- and out-points from the take's words (the gaps between them), not from round seconds.

## Common mistakes

- `startFrom={12.4}` meaning seconds. Write `12.4 * fps`.
- `endAt={dur}`. It is a source frame, not a clip length: `startFrom + dur`.
- `endAt` at or before `startFrom`: it throws.
- Every clip without a Sequence, so all of them play from frame 0 on top of each other.
- `transform: scale(1.2)` on a Video inside a box without `overflow: hidden`: the zoom spills over the parts around it.
- An `objectPosition` or `transform` on a Video with `framing="face"`: either one turns the framing off, and the crop
  stays where you put it while the speaker moves. Zoom a framed take with `punchIn`.
- A zoom on every sentence. That is the template ad the floor refuses. Punch in where the line earns it.
- Cutting on round seconds instead of word gaps.
- Leaving the clip's sound at unity under a loud bed. Balance it in `motion/sound`.

## Example: a talking head cut into three clips

```tsx
import { AbsoluteFill, Composition, Sequence, Video, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from "raea";
import { css } from "./styles.gen";

const TAKE = staticFile("takes/take01.mp4");

interface Clip { id: string; srcIn: number; from: number; to: number; punch?: number }
/** where `raea frame` found the face, in percent of the take's picture */
const FACE = { x: 46, y: 38 };

/** in-points (seconds into the take) sit in gaps between words; from/to are composition frames */
const CLIPS: Clip[] = [
  { id: "c1", srcIn: 3.2, from: 0, to: 58 },
  { id: "c2", srcIn: 7.86, from: 58, to: 124, punch: 1.15 },
  { id: "c3", srcIn: 15.1, from: 124, to: 180 },
];

/** A clip framed on the face (punched in when it has a punch), with 12 ms fades at its joins. */
function FaceClip({ clip }: { clip: Clip }) {
  const { fps } = useVideoConfig();
  const startFrom = Math.round(clip.srcIn * fps);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Video
        name={clip.id}
        src={TAKE}
        startFrom={startFrom}
        endAt={startFrom + (clip.to - clip.from)}
        gainDb={0}
        fadeIn={0.012}
        fadeOut={0.012}
        style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: `${FACE.x}% ${FACE.y}%`, transform: `scale(${clip.punch ?? 1})` }}
      />
    </AbsoluteFill>
  );
}

/** A screen recording with a slow linear push-in that keeps its top edge put. */
function ScreenClip({ srcIn, dur }: { srcIn: number; dur: number }) {
  const f = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const z = interpolate(f, [0, dur], [1, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const startFrom = Math.round(srcIn * fps);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Video
        src={staticFile("screen.mov")}
        startFrom={startFrom}
        endAt={startFrom + dur}
        muted
        style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%", transform: `translateY(${(z - 1) * (height / 2)}px) scale(${z})` }}
      />
    </AbsoluteFill>
  );
}

export default function Cut() {
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--brand-background)" }}>
      <style>{css}</style>
      {CLIPS.map((c) => (
        <Sequence key={c.id} from={c.from} durationInFrames={c.to - c.from} name={`clip ${c.id}`}>
          <FaceClip clip={c} />
        </Sequence>
      ))}
      <Sequence from={180} durationInFrames={60} name="screen">
        <ScreenClip srcIn={4} dur={60} />
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="cut" component={Cut} width={1080} height={1920} fps={30} durationInFrames={240} />);
```
