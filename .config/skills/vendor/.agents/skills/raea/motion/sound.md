# Sound: Audio, sao and Speech, the music bus, gains, fades, Mix

## What to do

- Put each sound in its own `<Sequence from={frame} layout="none" name>` with an `<Audio>` inside. The Sequence's
  `from` is when the sound starts, and its `durationInFrames` (optional) cuts it off. `layout="none"` because a sound
  draws nothing.
- Set levels in decibels with `gainDb`. `volume` is the same thing as a linear gain (1 is unity, 0.5 is about -6 dB,
  values above 1 boost). Either one can be a function of the sound's own frame (0 at its first frame) for a duck or
  a swell. `gainDb` wins when both are given.
- Fade with `fadeIn` and `fadeOut`, in seconds. They ramp from and to silence at the start and end of where the sound
  plays, at the audio's own rate, and multiply with the gain. Use about 1 to 1.4 s at the end of a bed, and
  0.012 s at a cut.
- Make foley and sound effects with `sao(prompt, {seconds})` (2 s by default; up to 11.9 s) and pass the result to
  `<Audio src>`. Write prompts the way the approved pieces do: the sound, its character and what to leave out ("deep
  punchy cinematic impact hit, tight, no reverb tail"; "bubbly UI pop click, short, dry"). Ask for the length you
  need.
- Make the music bed in Tone.js on `Tone.buses.music` (`motion/music`): instruments in a `Sampler` (TokenSynth notes
  or a sample library's), playing a `Part` or `Sequence`. Duck it under the voice with
  `Tone.buses.music.duck(Tone.buses.voice, { amount: -12 })`, give the voice `<Audio bus="voice">`, and set the bed's
  level on the bus: `Tone.buses.music.volume.value = -21`, then `Tone.buses.music.volume.rampTo(-12, 0.3, t)` to lift
  it at `t` seconds for the end card.
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
  | music bed | -21 dB, rising to about -12 dB once the voice stops (the end card) | -12 to -15 dB |
  | foley hits, whooshes, pops | -16 to -22 dB | -1 to -6 dB |

  These are starting points; listen and decide.
- `raea sao "PROMPT" --seconds 1.2 -o media/sfx/hit.wav` makes a sound now, to check it before it goes in; the edit's
  `sao("PROMPT", { seconds: 1.2 })` then plays that one rather than making another.

## Why

A sound placed without a Sequence starts at frame 0 with everything else. A Sequence with the default layout adds a
full-frame box that paints over the parts beneath it.

`sao()` returns an asset `{kind, prompt, seconds, id, src}` whose id is a stable hash of the kind, the
prompt and the length. The renderer makes each asset once and caches it in the object's `assets/`. SAO runs on this
computer (Stable Audio Open, a few seconds a sound; it installs itself the first time). The same call always reuses
the same sound, and changing one word of the prompt makes a new one. So settle the prompt before you iterate on
gains.

Policy: music is Tone.js instruments (TokenSynth, the sample libraries, synths), SAO makes foley, and Pocket TTS
(`<Speech>`) says narration over the picture, all on this computer. Any other generation is a `raea gen` step
(`motion/gen`). (`lyria()`, a remote music model, is retired: a
new take is refused, and a bed of instruments can be cut on the bar and edited note by note anyway.)

Sound sells the cut, but one move everywhere is a lint: a whoosh on every entrance flattens all of them. Give
foley to the moments that are physical (a slam, a strike-through, a card landing on the beat) and let others be
silent.

## Check the sound before you call it done

Frames get looked at; sound has to be measured, because a broken bed is easy to miss on one listen and obvious to
everyone else. Two checks, both cheap:

- **The render says when a sound runs out.** `WARN  sound X runs out N s before its stretch ends` means the
  source is shorter than its Sequence and still sounding (or asked for a fadeOut) at its end: it stops dead and the
  fade never plays, so a 10 s `sao()` bed under a 12 s cue cuts off mid-line. `loop` alone doesn't help: a sound
  loops only between `startFrom` and `endAt`, and that loop is a hard jump. Tile it instead: copies of the take end to
  end, each in its own Sequence, crossfading over 1.5 s (`fadeIn`/`fadeOut`), or make the take as long as the span.
- **Check the finished file.** `raea check FILM.mp4 --words words.json` (the voice's words on the film's clock)
  reports, by timecode, dead stops (a steady sound that ends in one 10 ms step: fade a bed out over 100 ms or more;
  a voice ending its word isn't one), stretches with no voice louder than
  the voice, a bed closer than 12 dB to the voice over it, and a true peak over -1 dBTP. Fix every line it prints, or
  say why it stands.

Set levels from measurements, not by ear on one pass. Measure each source's integrated loudness (`ffmpeg -i F -af
ebur128 -f null -`) and set its gain against the narration's: beds 15-20 LU under the voice; a film's own sound,
where the narration stops, about 3 LU under it with its loudest 3 s no more than 2 LU over; never boost a near-silent
take more than +3 dB (its hiss comes up with it). A flat gain on every archive clip is how one film's main title
ends up shouting over the narrator while another is inaudible.

## Common mistakes

- An `<Audio>` without a Sequence, or in a Sequence without `layout="none"`.
- `volume={-6}` meaning decibels. That throws, because volume is a non-negative linear gain. Write `gainDb={-6}`.
- A bed at -6 dB under the voice. The voice must stay intelligible over everything (floor).
- `loop` on an `<Audio>` without `endAt` to stretch a short bed: nothing loops, it plays once and stops dead (the
  render warns). With `endAt` it repeats with a hard jump at each loop; tile copies with crossfades instead.
- Two `<Mix>` in one composition: it throws.
- No `<Mix>`: the sum plays as it is, at whatever loudness it adds up to.
- Rewording a `sao()` prompt on every pass. Each new prompt makes a new sound .
- `style` on an `<Audio>`: Audio has no picture and takes no style.
- Hand-placing dozens of game sounds from a log. Cue them from `useGameEvents` (`motion/games`).
- Writing music note by note in `<Audio>` files, or a game's sounds by hand. Write them in Tone.js (`motion/music`):
  instruments, the Transport, buses with ducking, and `<Tone.Sfx>` for one-shots.

## Example: a bed that lifts for the end card, a voice, foley on two beats

```tsx
import { AbsoluteFill, Audio, Composition, Mix, Sequence, registerRoot, sao, staticFile } from "raea";
import * as Tone from "raea/tone";
import { css } from "./styles.gen";

const FRAMES = 300;
const END_CARD = 252; // the voice stops here

// the bed: a TokenSynth pulse and a pad on the music bus, ducked under the voice, lifted for the end card
Tone.getTransport().bpm.value = 100;
Tone.buses.music.duck(Tone.buses.voice, { amount: -12 });
Tone.buses.music.volume.value = -21;
Tone.buses.music.volume.rampTo(-12, 0.33, END_CARD / 30);
const pluck = new Tone.Sampler({ urls: Tone.tokensynth("a soft muted electric piano, warm, short decay", ["C3", "C4"], { seconds: 1 }) }).connect(Tone.buses.music);
const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsine" }, envelope: { attack: 0.6, release: 1.5 }, volume: -12 }).connect(Tone.buses.music);
new Tone.Sequence((t, n) => pluck.triggerAttackRelease(n, "8n", t), ["A3", "E4", "C4", "E4"], "8n").start(0);
new Tone.Part((t, c) => pad.triggerAttackRelease(c, "2m", t), [["0:0", ["A3", "C4", "E4"]], ["2:0", ["F3", "A3", "C4"]]]).start(0);
Tone.getTransport().start();

const HIT = sao("deep punchy impact hit, tight, no reverb tail", { seconds: 1.2 });
const POP = sao("bubbly UI pop click, short, dry", { seconds: 0.6 });
const VOICE = staticFile("voice/vo01.wav"); // the person's narration, as a file

/** Every sound, in time order. */
const SOUNDS = [
  { id: "hit", from: 0, gainDb: -16, src: HIT, fade: 0, bus: "sfx" },
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
