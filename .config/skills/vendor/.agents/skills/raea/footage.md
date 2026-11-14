# Footage and editing

Cutting real footage: talking takes cut by what they say, framing a face, captions and parts cued to words, cuts timed
to a song, and the person's footage libraries. The files under `motion/` and `craft/` are copies of raea's craft guides
(`raea guide NAME` prints the same text); read one or two at a time, when the task reaches them.

## Which file to open

| You are... | Open |
|---|---|
| cutting takes, trimming, fading, framing a face, a clip's own sound | [motion/footage.md](motion/footage.md) |
| captions, or anything cued to what someone says (`word("phrase")`) | [motion/words.md](motion/words.md) |
| deciding when things happen, scene lengths, pacing cuts to a song's energy | [motion/timing.md](motion/timing.md) |
| putting a part over a face, keeping clear of platform zones, the proof frame | [motion/placement.md](motion/placement.md) |
| dressing a talking take with ready parts (lower thirds, callouts) | [motion/parts.md](motion/parts.md) |
| the bed, the voice and clip sound under the cut | [sound.md](sound.md) |
| a note on an edit ("tighter", "the hook is slow") | [craft/verbs/recut.md](craft/verbs/recut.md), [craft/verbs/retime.md](craft/verbs/retime.md) |

## The verbs

All HEADLESS (reference/cli.md has every flag):
- `raea library search "WORDS"` finds a take in the person's libraries; `raea library` manages them.
- `raea cut TAKE "line" ...` writes cuts.ts and words.json: the take cut in the pauses around each line it says.
- `raea frame TAKE` says how a take fits the edit (`<FaceFrame>` for a talking take, `<ScreenFit>` for a screen).
- `raea song FILE --plot FILE.song.png` maps a song's beats, sections, builds and drops: time cuts from the map, never a
  constant BPM.
- `raea media probe|still|sheet|loudness|cuts|freezes|proxy|trim|concat` inspects and prepares media; `raea mezz`
  makes a smooth-scrubbing ProRes copy of a long-GOP source over 1080p.
- `raea track CLIP.mp4` solves the clip's camera for `<Matchmove>`, to put 3D into the footage ([3d.md](3d.md)).

## Checks

`raea check --quick` after each save (text clipped, cramped, out of the safe areas), then the render's
`raea check --manifest` before you show it ([motion/rendering.md](motion/rendering.md)).
