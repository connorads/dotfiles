# Sound: Audio, sao and Speech, the music bus, gains, fades, Mix

## What to do

- Decide what each scene is heard as before placing anything: silence, the scene's own sound (footsteps, a room, a
  machine: what the people on screen would hear), source music, score, effects, a voice. Music is a decision per
  scene, never a bed by default (`motion/music` has the spotting and the writing; `motion/sources` where each sound
  can come from).
- Put each sound in its own `<Sequence from={frame} layout="none" name>` with an `<Audio>` inside. The Sequence's
  `from` is when the sound starts, and its `durationInFrames` (optional) cuts it off. `layout="none"` because a sound
  draws nothing.
- Set levels in decibels with `gainDb`. `volume` is the same thing as a linear gain (1 is unity, 0.5 is about -6 dB,
  values above 1 boost). Either one can be a function of the sound's own frame (0 at its first frame) for a duck or
  a swell. `gainDb` wins when both are given.
- Fade with `fadeIn` and `fadeOut`, in seconds. They ramp from and to silence at the start and end of where the sound
  plays, at the audio's own rate, and multiply with the gain. Use about 1 to 1.4 s where an ambience or a source cue
  leaves the scene, and 0.012 s at a cut. A score ends on its last hit instead (`motion/music`).
- Make foley and sound effects with `sao(prompt, {seconds})` (2 s by default; up to 11.9 s, and a longer ask comes
  back 11.9 s long) and pass the result to `<Audio src>`, or take a recorded one from a pack (`motion/sources`).
  Write prompts the way the approved pieces do: the sound, its character and what to leave out ("deep punchy
  cinematic impact hit, tight, no reverb tail"; "bubbly UI pop click, short, dry"). Ask for the length you need.
- Design an effect in layers, each its own short prompt or take, laid on the same frame: a transient (the first 5 to
  30 ms: a snap, a click), a body that says what the thing is (50 to 500 ms), weight for a big hit only (under
  120 Hz, short), and a tail that puts it in its room (0.3 to 3 s). Vary a sound that repeats: 3 to 5 takes (another seed or another file), a semitone or two and a couple of dB apart.
- Give a place its room tone and keep it across that place's cuts: no digital silence under picture, an ambience
  that changes when the place does, and the next scene's sound starting about half a second before its cut. Foley
  is three passes, each on the frame of contact: steps, cloth, props.
- Place what's in the scene where it is: pan it to its side of the frame (`Tone.Panner`, a Channel's `pan`), give
  it the room's reverb, and narrow a device (a phone, a radio) with a high-pass and a low-pass. In 3D, `<Sound3D
  src at>` places it and the camera hears it move.
- When the piece has music, write it in Tone.js on `Tone.buses.music` (`motion/music`): instruments in a `Sampler`
  (a sample library's notes, or TokenSynth's), parts in a `Part` or `Sequence`, composed for the cut. Duck it under
  the voice with `Tone.buses.music.duck(Tone.buses.voice, { amount: -12 })`, give the voice `<Audio bus="voice">`,
  and set the music's level on the bus: `Tone.buses.music.volume.value = -21`, then
  `Tone.buses.music.volume.rampTo(-12, 0.3, t)` to lift it at `t` seconds for the end card.
- Narration over the picture, when the footage has no voice for it, is
  `<Speech text="the words" start={frame} />` from `raea/speech` (Pocket TTS, on this computer; `voice` picks a
  Pocket voice or a WAV of one).
- Master the sum with one `<Mix lufs={-14} ceiling={-1.5} />` per composition. It brings the whole mix to -14 LUFS
  integrated and limits true peaks under the ceiling, which is what the floor's loudness defect asks for.
- Put the sounds in the tree in time order. The engine keys a sound's stretch by its place in the tree, so adding a
  sound in the middle of the list can split the ones after it.
- Balance relative to the voice. The approved pieces, mastered by `<Mix>` to -14 LUFS, sit like this:

  | sound | with a voice | without one (promo, deck, game) |
  |---|---|---|
  | the voice clips | about 0 dB | none |
  | music | -21 dB, rising to about -12 dB once the voice stops (the end card) | -12 to -15 dB |
  | foley hits, whooshes, pops | -16 to -22 dB | -1 to -6 dB |

  These are starting points; listen and decide.
- `raea sao "PROMPT" --seconds 1.2 --dir EDIT_DIR -o EDIT_DIR/media/sfx/hit.wav` makes a sound now, to check it
  before it goes in, and keeps it in the edit's asset store (`--dir` is the edit's folder; without it, the folder you
  run it from), so the edit's `sao("PROMPT", { seconds: 1.2 })` then plays that one rather than making another.
  `--seed 2` makes another take of the same prompt; play that file by its path (`staticFile("sfx/hit-2.wav")`), since
  `sao()` has no seed.

## Why

A sound placed without a Sequence starts at frame 0 with everything else. A Sequence with the default layout adds a
full-frame box that paints over the parts beneath it.

`sao()` returns an asset `{kind, prompt, seconds, id, src}` whose id is a stable hash of the kind, the
prompt and the length. The renderer makes each asset once and caches it in the object's `assets/`. SAO runs on this
computer (Stable Audio Open Small, a few seconds a sound; it installs itself the first time, and `motion/sources`
says what that fetches). It does better on effects and field recordings than on music. The same call always reuses
the same sound, and changing one word of the prompt makes a new one. So settle the prompt before you iterate on
gains.

Policy: music is notes on Tone.js instruments (sample libraries first, TokenSynth, synths), SAO and recorded packs
make effects and foley, and Pocket TTS (`<Speech>`) says narration over the picture, all on this computer. Any other
generation is a `raea gen` step (`motion/gen`). (`lyria()`, a remote music model, is retired: a new take is refused,
and music written as notes can be cut on the bar and edited note by note anyway.)

Sound sells the cut, but one move everywhere is a lint: a whoosh on every entrance flattens all of them. Give
foley to the moments that are physical (a slam, a strike-through, a card landing on the beat) and let others be
silent.

## Check the sound before you call it done

Frames get looked at; sound has to be measured, because a broken mix is easy to miss on one listen and obvious to
everyone else. Two checks, both cheap:

- **The render says when a sound runs out.** `WARN  sound X runs out N s before its stretch ends` means the
  source is shorter than its Sequence and still sounding (or asked for a fadeOut) at its end: it stops dead and the
  fade never plays, so a 10 s `sao()` ambience under a 12 s scene cuts off mid-line. `loop` alone doesn't help: a
  sound loops only between `startFrom` and `endAt`, and that loop is a hard jump. Tile it instead: copies of the take
  end to end, each in its own Sequence, crossfading over 1.5 s (`fadeIn`/`fadeOut`), or make the take as long as the
  span.
- **Check the finished file.** `raea check FILM.mp4 --words words.json` (the voice's words on the film's clock)
  reports, by timecode, dead stops (a steady sound that ends in one 10 ms step: fade it out over 100 ms or more;
  a voice ending its word isn't one), stretches with no voice louder than
  the voice, music closer than 12 dB to the voice over it, and a true peak over -1 dBTP. Fix every line it prints, or
  say why it stands.

Set levels from measurements, not by ear on one pass. Measure each source's integrated loudness (`ffmpeg -i F -af
ebur128 -f null -`) and set its gain against the narration's: music 15-20 LU under the voice; a film's own sound,
where the narration stops, about 3 LU under it with its loudest 3 s no more than 2 LU over; never boost a near-silent
take more than +3 dB (its hiss comes up with it). A flat gain on every archive clip is how one film's main title
ends up shouting over the narrator while another is inaudible.

## Common mistakes

- An `<Audio>` without a Sequence, or in a Sequence without `layout="none"`.
- `volume={-6}` meaning decibels. That throws, because volume is a non-negative linear gain. Write `gainDb={-6}`.
- Music at -6 dB under the voice. The voice must stay intelligible over everything (floor).
- A pad, a drone or one `sao()` take of "ambient music" laid under the whole piece as its score. Decide what each
  scene needs, and write the music (`motion/music`).
- An effect from one take with nothing under it: a click that should be a door. Layer it.
- `loop` on an `<Audio>` without `endAt` to stretch a short ambience: nothing loops, it plays once and stops dead
  (the render warns). With `endAt` it repeats with a hard jump at each loop; tile copies with crossfades instead.
- Two `<Mix>` in one composition: it throws.
- No `<Mix>`: the sum plays as it is, at whatever loudness it adds up to.
- Rewording a `sao()` prompt on every pass. Each new prompt makes a new sound.
- `style` on an `<Audio>`: Audio has no picture and takes no style.
- Hand-placing dozens of game sounds from a log. Cue them from `useGameEvents` (`motion/games`).
- Writing music note by note in `<Audio>` files, or a game's sounds by hand. Write them in Tone.js (`motion/music`):
  instruments, the Transport, buses with ducking, and `<Tone.Sfx>` for one-shots.

## Example: a cue that lands on the end card, a voice, a layered hit

```tsx
import { AbsoluteFill, Audio, Composition, Mix, Sequence, registerRoot, sao, staticFile } from "raea";
import * as Tone from "raea/tone";
import { css } from "./styles.gen";

const FRAMES = 300;
const END_CARD = 252; // the voice stops here

// the music (motion/music): a sampled piano, chords that change every bar under a motif that answers the voice,
// ducked under it, lifted for the end card, and ending on a chord on that cut. The tempo is set from the cut:
// four bars to the end card, so its cut is a downbeat.
Tone.getTransport().bpm.value = (4 * 4 * 60 * 30) / END_CARD; // about 114 bpm
Tone.buses.music.duck(Tone.buses.voice, { amount: -12 });
Tone.buses.music.volume.value = -21;
Tone.buses.music.volume.rampTo(-12, 0.33, END_CARD / 30);
// `raea sounds get salamander/piano` printed its roots a minor third apart (D#2 is the file Ds2.mp3); these cover
// F2 to G5, what the cue plays
const ROOTS = ["D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5"];
const piano = new Tone.Sampler({
  urls: Object.fromEntries(ROOTS.map((n) => [n, staticFile(`sounds/salamander-piano/${n.replace("#", "s")}.mp3`)])),
  release: 1,
}).connect(new Tone.Reverb({ decay: 1.4, wet: 0.2 }).connect(Tone.buses.music));
const CHORDS = [["A2", "E3", "C4"], ["F2", "C3", "A3"], ["C3", "G3", "E4"], ["G2", "D3", "B3"]];
new Tone.Part((t, c) => piano.triggerAttackRelease(c.notes, "4n", t, c.vel), CHORDS.flatMap((chord, bar) => [
  { time: `${bar}:0`, notes: chord, vel: 0.55 },
  { time: `${bar}:2:2`, notes: chord, vel: 0.4 },
])).start(0);
new Tone.Part((t, n) => piano.triggerAttackRelease(n.note, "8n", t, n.vel), [
  { time: "1:1", note: "E5", vel: 0.7 }, { time: "1:1:2", note: "D5", vel: 0.5 }, { time: "1:2", note: "C5", vel: 0.6 }, { time: "1:3", note: "A4", vel: 0.65 },
  { time: "3:1", note: "G5", vel: 0.75 }, { time: "3:1:2", note: "F5", vel: 0.5 }, { time: "3:2", note: "E5", vel: 0.6 }, { time: "3:3", note: "D5", vel: 0.7 },
]).start(0);
Tone.getTransport().schedule((t) => piano.triggerAttackRelease(["A2", "E3", "A3", "C4", "E4"], "1m", t, 0.8), "4m");
Tone.getTransport().start();

// one hit in three layers, on the same frame: the snap that starts it, the body that says what it is, the room's tail
const SNAP = sao("sharp wooden snap, close, very short, dry", { seconds: 0.3 });
const HIT = sao("deep punchy impact hit, tight, no reverb tail", { seconds: 1.2 });
const TAIL = sao("the reverb tail of one impact in a large hall, no attack", { seconds: 2.5 });
const POP = sao("bubbly UI pop click, short, dry", { seconds: 0.6 });
const VOICE = staticFile("voice/vo01.wav"); // the person's narration, as a file

/** Every sound, in time order. */
const SOUNDS = [
  { id: "hit-snap", from: 0, gainDb: -20, src: SNAP, fade: 0, bus: "sfx" },
  { id: "hit", from: 0, gainDb: -16, src: HIT, fade: 0, bus: "sfx" },
  { id: "hit-tail", from: 0, gainDb: -24, src: TAIL, fade: 0, bus: "sfx" },
  { id: "voice", from: 15, to: END_CARD, gainDb: 0, src: VOICE, fade: 0.012, bus: "voice" },
  { id: "pop", from: END_CARD + 2, gainDb: -17, src: POP, fade: 0, bus: "sfx" },
] as const;

export default function SoundBed() {
  return (
    <AbsoluteFill style={{ backgroundColor: "var(--brand-background)" }}>
      <style>{css}</style>
      {SOUNDS.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={"to" in s ? s.to - s.from : undefined} name={s.id} layout="none">
          <Audio name={s.id} src={s.src} gainDb={s.gainDb} fadeIn={s.fade} fadeOut={s.fade} bus={s.bus} />
        </Sequence>
      ))}
      <Mix lufs={-14} ceiling={-1.5} />
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="sound" component={SoundBed} width={1080} height={1920} fps={30} durationInFrames={FRAMES} />);
```
