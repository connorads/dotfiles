# Music and sound effects: Tone.js on raea (raea/tone)

## Decide what the picture needs before writing a note

Music is never a default. A bed under every second makes every piece sound like every other one, and a held pad or
drone under a long reverb is what generated music sounds like. Before any instrument goes in:

- Name what each stretch is heard as: silence; the scene's own sound (diegetic: footsteps, a room, a radio, a game's
  machines, anything the people on screen could hear); source music (music playing in the scene); score (music only
  the audience hears); effects; a voice. Several at once is fine, and none is a choice too: a pitch with a voice may
  need only effects and a four-second sting on the end card. Write the decision in the storyboard or DIRECTION.md,
  one line a scene.
- Spot the cut the way a music editor does: number each cue (1m1, 1m2...) with the frame it starts on, the moments
  it has to hit (the hook, a reveal, the logo), where it turns (where the edit changes idea) and where it stops. A
  cue ends on a hit, the "button" (the last chord on the last cut or the logo), not on a fade. Half a bar of silence
  before a reveal is what makes the reveal.
- Take the tempo from the cut. Frames per beat = fps × 60 / bpm: at 30 fps, 12 frames at 150 bpm, 15 at 120, 20 at
  90. Pick the bpm that puts the main cuts on beats and the biggest on downbeats, or set it so they do
  (`bpm.value = (bars * 4 * 60 * fps) / framesToTheCut`). Shots of 1 to 1.5 s suit 120 to 160 bpm; shots of 3 to 5 s
  suit 70 to 100, or a half-time feel. With a song, cut to its map instead (`motion/timing`).
- A sustained texture (a held pad, a drone, a reverb wash) goes in only when the scene asks for one by name ("dread",
  "the ship's hum") and the direction says why in a line. Even then something over it moves.

## What to do

- Write music and sound effects in Tone.js, as its docs write them: `import * as Tone from "raea/tone"`, then
  instruments, effects, `connect`/`toDestination`/`chain`, `triggerAttackRelease`, and the Transport with `Loop`,
  `Part`, `Sequence` and `Pattern`. What you know of Tone works; the differences are below. It's a DAW in code: a
  track is an instrument and its effects into a bus, a clip is a `Part` or `Sequence`, the arrangement is where each
  starts and stops on the Transport.
- Make music from instruments playing notes, not from a generated track. Each instrument is a `Tone.Sampler` (a kit
  is `Tone.Players`); fill it one of three ways:
  - **A sample library** for a real instrument, first: `raea sounds cello` searches the open libraries raea carries
    (the Salamander grand piano; FluidR3's 128 General MIDI instruments, every note; tonejs-instruments' strings,
    brass, woodwinds and guitars; the Versilian library's keyboards, harps, mallets, drums and percussion), and
    `raea sounds get tonejs-instruments/cello` copies its notes into `media/sounds/` and prints the `Sampler` that
    plays them. Drums and hits come as takes for `Tone.Player`s. Whole orchestras, multi-velocity kits and drummers'
    grooves are fetched by hand (`motion/sources`).
  - **TokenSynth** for a timbre no library has: `Tone.tokensynth("a bowed saw, close, eerie", ["C3", "E3", "G#3",
    "C4", "E4", "G#4", "C5"], { seconds: 2 })` renders those root notes, a major third apart, once on this computer,
    and the Sampler pitches between them. Describe
    the timbre the way you'd describe a patch ("a soft wooden marimba, felt mallet, warm"; "a bright analog synth
    lead, saw, short decay"); a note's `seconds` is how long it's held (under 5). Its takes need curating (below).
  - Tone's own synths (`Synth`, `PolySynth`, `MonoSynth`, `MembraneSynth`, `MetalSynth`, `NoiseSynth`, `FMSynth`) for
    parts that are synthetic on purpose: an 808 kick, an analog bass, a chiptune lead, a riser.
- Make sound effects and foley with SAO or a recorded pack: `Tone.sao("a bright arcade coin chime, short", { seconds:
  1 })` in a Sampler or Player, or `sao(...)` in an `<Audio>`, built in layers (`motion/sound`). Narration over the
  picture is `<Speech>` from `raea/speech` (Pocket TTS, local; `motion/sound`).
- Build the graph at the top level of the file: every instrument, effect and channel, and how they connect. The graph
  is the one the composition has when its first frame renders. Schedule notes with the Transport (or with explicit
  times). Never trigger notes from inside a component's render: a game's one-shots go through `<Tone.Sfx>`.
- Set the tempo before building any Part: a Part reads its times at the tempo when it's made.
- Time 0 is the composition's first frame. `Tone.now()` is 0 at the top level and the event's time inside a callback,
  so `Tone.getTransport().start()` at the top level starts the music at frame 0. Every note lands on its own sample,
  so a render and a play are the same.
- Route through the buses: `Tone.buses.music`, `.sfx`, `.voice`, `.ambience`, `.ui`. Connect Tone nodes to them, and
  give `<Audio>` and `<Video>` a `bus="voice"` (or another bus) prop. Each bus is a Tone `Channel`: `volume`, `pan`,
  `mute`, `solo`, `send`/`receive`.
- Duck the music under the voice with `Tone.buses.music.duck(Tone.buses.voice, { amount: -12 })`; do the same for
  ambience. Start at -10 to -14 dB, 40 ms attack and 300 to 400 ms release; under a sparse cue, where pumping shows,
  -6 to -8 dB, 80 ms and about 0.9 s. Then listen.
- Keep one `<Mix lufs={-14} ceiling={-1.5} />` per composition. The master measures the whole core, Tone included.
- In a game, fire a one-shot on the exact frame something happens: `<Tone.Sfx when={...} play={(t) => ...} />` with
  `when` true on that frame only (a frame from `useGameEvents`, or a machine's transition). Give one-shots
  `Tone.vary(instrument, { pitch: 0.3, volume: 2 })` so repeats don't sound copied (the variation is seeded by the
  frame, so a replay is the same). Cap their voices with `maxPolyphony` (the oldest is stolen, faded in 5 ms).
- In a timeline, cut on the music: `Tone.Time("1m").toFrames(fps)` is a bar in frames, and `Tone.Time("4n")` a beat.
- To hear a sound before writing it in, `raea sao "PROMPT" --seconds 1 --dir EDIT_DIR -o EDIT_DIR/media/sfx/try.wav`
  or `raea tokensynth "TIMBRE" --notes C3 --dir EDIT_DIR -o EDIT_DIR/media/try/` makes it now and keeps it in the
  edit's asset store (`--dir` is the edit's folder; without it, the folder you run it from), so the edit's own call
  with the same words and settings then plays what was made instead of making it again. Another `--seed` makes
  another take; play a seed's file by its path (`staticFile("sfx/try.wav")`), since `sao()` in the edit has no seed.
- When SAO or TokenSynth isn't installed yet, `raea setup-audio` installs it (`motion/sources` says what it fetches
  and what to do when it fails).

## Writing music for picture

Write it as a composer would, for this cut:

- **A motif first.** Three to seven notes over two to four bars, with a rhythm of its own, before any chord. Then
  vary it rather than loop it: answer it, fragment it, move it to another instrument or register, put new chords
  under it. End the cue on it.
- **Harmony that moves.** In an active cue, change chord every bar or every two beats; keep chords of two to four bars
  for a slow passage. Move the inner voices by step or hold a common tone, set the bass against the tune (contrary
  motion, inversions so it walks), and resolve a pedal when it ends. Keep the low end open: no thirds below about C3,
  fifths down to about C2, only octaves under that.
- **Rhythm and groove.** At least one part moves in eighths or sixteenths: an ostinato, a pizzicato, an arpeggio, a
  kit, hand percussion. Accent where the picture moves. Spread velocities (0.35 to 0.95, not all 0.8), and put a
  played part a few milliseconds off the grid (5 to 15 ms, written into the note's time: `humanize` is ignored here).
  A drummer's recorded groove beats one typed in (Groove MIDI, `motion/sources`).
- **Orchestrate by register.** One job each: a bass (E1 to C3), sparse harmony (C3 to C5), one lead (C4 to C6), the
  rhythm, colour on top (glockenspiel, celesta, harp). Hand the tune to a new instrument each section, and use the
  articulations the library has (staccato, legato, pizzicato, tremolo, a swell). A pad, where the scene names one,
  is glue 12 dB or more under the lead, never the part.
- **The arrangement follows the edit.** Sections change where the edit changes idea: build by adding parts and by
  switching sections, on bar lines; peak, then strip back; drop out before the reveal; end on the button. A sting
  lasts 1 to 4 s, sits in the cue's key and lands on a beat.
- **Write around the voice.** The tune answers in the gaps between lines, and the arrangement thins under speech.
- **Each instrument its own room.** A short reverb per instrument or per section (decay 1.2 to 2.5 s, wet 0.15 to
  0.3), never one long wash over the bus: a 6 s reverb and a low-pass on the whole music bus erase every attack, and
  that is how a score turns into a drone.
- **Source music lives in the scene.** A radio, a band in the room, a phone: narrow it to the device (a high-pass
  around 300 Hz and a low-pass around 3.5 kHz for a small speaker), pan it to where it is (`Tone.Panner`), put it in
  the room's reverb, and let the scene's own sound sit with it. Crossing over is strong: a radio song that opens out
  to full range as it becomes the score, a score hit that lands on an action in the scene.
- Leave silence. Let the music start after a chapter card clears and stop before the next; let a card sit on one low
  note.
- Write for this picture's feeling, not a genre's surface: a stock walking bass and brushes under everything reads as
  pastiche as surely as a pad does.
- Period source music can be real: US sound recordings published before 1926 and compositions published before 1931
  are public domain in the US (2026). archive.org's 78rpm transfers give the period's own sound; play them as
  `<Audio bus="music">`, narrowed and placed as source music, ducked with the rest.
- Synth drums (`MembraneSynth` kicks, noise "brushes") sound synthetic on anything acoustic; use a library's recorded
  kit (`raea sounds kick`, `snare`, `hihat`).

## Instruments from TokenSynth: build a library, don't trust a take

A TokenSynth note is one sample from a model, and a lot of takes are bad. In a 35-minute documentary score (2026-10-20),
12 of 30 single-seed root notes failed: hiss and buzz in place of a horn, a sax or accordion an octave (or 34
semitones) off, a piano note still at full level when its file ends, so every held note stopped with a click. That is
the "vanilla and abrasive" sound. It learned from 5-second notes at four velocities, so it gives one dynamic and can
miss the pitch asked for. So:

- Reach for an open sample library first for a standard instrument (`raea sounds piano`, `sounds get
  salamander/piano`): a recording, no gamble. Use TokenSynth for what no library has, or a timbre you can describe
  better than find.
- Declare each instrument as a candidate, not a call: its timbre, roots every 3 to 4 semitones over the range it plays
  (a Sampler pitched further than that starts to sound fake), 3 or more seeds, and `seconds` long enough for the
  sound to die away on its own (4 for piano, 6 for sustained strings).
- Render every candidate through a `Sampler` (one per instrument and seed, each root played once), never through an
  `<Audio>` of a tokensynth note: today an `<Audio>` drops the note's pitch and seed and makes the prompt alone.
- Measure and pick: `uv run --with numpy --with soundfile python3 -I TOOLS/tokensynth/curate.py EDIT_DIR` (TOOLS is
  `tools/` in a raea checkout, `share/raea/tools/` beside an installed raea) checks each
  take's pitch (cents off the note), energy above 4 kHz, spectral flatness (noise), whether it has decayed by the end,
  and its onset, and writes `instruments.gen.json` ({timbre: {midi: seed}}) with the best passing seed per root.
  Build the score's Samplers from that file only; a root with no passing take gets more seeds, not a pass.
- Prefer timbres TokenSynth does well (felt or soft piano, sustained cello section, bowed or plucked bass, vibraphone,
  clarinet in its low register) to the ones it does badly (muted trumpet, tenor sax, accordion: breath and reed
  noise come out as hiss).
- For dynamics, render a soft and a loud velocity as two Samplers and pick one by each note's velocity.

## Why

Tone code here builds an edit's graph and an event list instead of driving Web Audio. The Transport's callbacks run in
time order as frames need them, and the one mixer core plays each event on its own sample. That makes a render
and a play of the same frames identical, and the same holds after a seek. A node made later than the first frame
rebuilds the graph (a pause in the sound), and a note triggered while rendering would fire again on every re-render.
So the graph goes at the top level, and in-game sounds go through `<Sfx>`.

Generated sources are made once per their inputs: the prompt, the length, a TokenSynth note's pitch, velocity, seed
and precision. They're normalised, cached as PCM in the object's `assets/`, and played like any file. TokenSynth and
SAO run on this computer and install themselves the first time they're used (minutes, once; `raea setup-audio` does
it ahead of time). Music written as notes on instruments can be edited note by note, cut on the bar and ducked per
part; a generated track can't.

Policy: music is notes on Tone.js instruments (sample libraries first, TokenSynth for a timbre no library has, synths
for synthetic parts), effects and foley are SAO or recorded packs (`motion/sources`), narration is Pocket TTS
(`<Speech>`), all local. Any other generation is a `raea gen` step, quoted and capped (`motion/gen`). (`lyria()`, a
remote music model, is retired: an older edit keeps the take it made, and a new one is refused.)

## Common mistakes

- A pad and a sine sub through a low-pass into a long reverb as the score. That's a drone, not music: write a motif,
  chords that move and a part with rhythm.
- One chord every four bars for a minute, or a two-bar loop for thirty seconds. Change the harmony every bar or two
  and the arrangement every four to eight.
- Every note at the same velocity, on the grid. Spread the dynamics and move played parts a few milliseconds.
- A cue that fades out at the end. End it on the last cut, on a chord or a hit.
- Music under every scene because the piece "needs music". Decide per scene; silence and the scene's own sound count.
- `synth.triggerAttackRelease(...)` in a component body. It fires on every render; use `<Tone.Sfx>`.
- `<Tone.Sfx when={g.coinTaken}>` on a flag the state holds for many frames: it fires on every one. Give it the
  frames the event happens on (`useGameEvents`).
- `new Tone.Synth()` inside a component. Make instruments at the top level.
- A `https://` URL for a Sampler or a Player. Sources are media files or generated assets, and the render has no
  network: `raea sounds get` puts a library's files in `media/` first.
- One root for a whole part, or one an octave. A Sampler stretched far from its root sounds chipmunked or muddy;
  give it a root every 3 to 4 semitones over the range the part plays: a library's own roots (`raea sounds get`
  with no `--notes` takes them a minor third apart, or every note the library sampled if it's sparser), or as many
  TokenSynth roots.
- Rewording a `tokensynth()` timbre on every pass: each new wording makes its notes again. Settle the timbre first.
- A sample library's licence ignored. CC-BY ones (FluidR3, Salamander, tonejs-instruments) need their credit where
  the piece is shown; `LICENCE.txt` beside the files has the line. VCSL is CC0.
- `part.loop = true` after `part.start()`: the Part plays once. Set `loop` and `loopEnd` first.
- `Tone.Draw.schedule` for visuals. There's no draw loop: read the frame (`useCurrentFrame`) and the same times.
- Cutting on `Tone.Time("1m").toFrames(fps)` across a tempo ramp. `Tone.getTransport().bpm.rampTo(120, 4)` bends the
  grid, as in Tone (the notes come closer together; an exponential ramp runs linear), but `Time(...)` is at the tempo
  when it's read, so after a ramp a bar is no longer that many frames.
- An LFO on an instrument's parameter (a synth's `detune`, a Sampler's `volume`): it does nothing yet. On an effect's
  or a `Gain`'s, `Volume`'s or `Channel`'s it works, as in Tone (`new Tone.LFO("4n", 400, 4000).start()
  .connect(filter.frequency)`).
- A Sequence or Loop with no `Tone.getTransport().start()`. Nothing plays until the Transport starts, as in Tone.

## Example: a cue with a motif, chords that move and a kit, cut on the bar

Spotted as one cue over nine one-bar cards: A (bars 1 to 4) piano and a pizzicato ostinato, the flute's motif from
bar 3; B (bars 5 to 8) the ostinato drops out, bass and kit come in, the motif climbs; the button on the end card's
cut. The instruments came from these commands, each printing the roots it fetched (with no `--notes`, a minor third
apart from C1 to C7, or every note the library sampled when that's sparser):

```sh
raea sounds get salamander/piano
raea sounds get fluid/pizzicato_strings
raea sounds get tonejs-instruments/flute
raea sounds get fluid/acoustic_bass
raea sounds get vcsl/bass-drum-1 && raea sounds get vcsl/snare-drum-modern-1 && raea sounds get vcsl/hi-hat-cymbal
```

```tsx
import { AbsoluteFill, Composition, Mix, Series, registerRoot, staticFile } from "raea";
import * as Tone from "raea/tone";

Tone.getTransport().bpm.value = 96; // first: a Part reads its times at the tempo when it's made
const BAR = Tone.Time("1m").toFrames(30); // 75 frames

// the roots each part's range needs, of those `raea sounds get` printed (D#3 is the file Ds3.mp3)
const notes = (dir: string, names: string[]) => Object.fromEntries(names.map((n) => [n, staticFile(`sounds/${dir}/${n.replace("#", "s")}.mp3`)]));
const room = new Tone.Reverb({ decay: 1.6, wet: 0.2 }).connect(Tone.buses.music);
const piano = new Tone.Sampler({ urls: notes("salamander-piano", ["A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4"]), release: 1, volume: -8 }).connect(room);
const pizz = new Tone.Sampler({ urls: notes("fluid-pizzicato_strings", ["D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4"]), release: 0.2, volume: -12 }).connect(room);
const flute = new Tone.Sampler({ urls: notes("tonejs-instruments-flute", ["E4", "A4", "C5", "E5", "A5", "C6"]), release: 0.4, volume: -6 }).connect(room);
const bass = new Tone.Sampler({ urls: notes("fluid-acoustic_bass", ["D#1", "F#1", "A1", "C2", "D#2"]), release: 0.3, volume: -6 }).connect(Tone.buses.music);
const kit = new Tone.Players({
  kick: staticFile("sounds/vcsl-bass-drum-1/BDrumNew_hit_v5_rr1_Sum.wav"),
  snare: staticFile("sounds/vcsl-snare-drum-modern-1/Snare2_HitSN_v5_rr1_Mid.wav"),
  hat: staticFile("sounds/vcsl-hi-hat-cymbal/HiHat_HitC_v3_rr1_Mid.wav"),
  ghost: staticFile("sounds/vcsl-hi-hat-cymbal/HiHat_HitC_v1_rr1_Mid.wav"), // the soft take, for the off-beats
}).connect(Tone.buses.music);

// a chord a bar, voiced so the inner notes move by step: Am F C G, then F G Am E
const CHORDS = [["A3", "C4", "E4"], ["A3", "C4", "F4"], ["G3", "C4", "E4"], ["G3", "B3", "D4"], ["A3", "C4", "F4"], ["G3", "B3", "D4"], ["A3", "C4", "E4"], ["G#3", "B3", "E4"]];
// comped, not held: the downbeat and the and-of-two, the second softer
new Tone.Part((t, c) => piano.triggerAttackRelease(c.notes, "8n", t, c.vel), CHORDS.flatMap((chord, bar) => [
  { time: `${bar}:0`, notes: chord, vel: 0.62 },
  { time: `${bar}:1:2`, notes: chord, vel: 0.42 },
])).start(0);

// A: an eighth-note ostinato on each chord's root (root, fifth, octave, fifth), accented on the beat
new Tone.Part((t, n) => pizz.triggerAttackRelease(n.note, "16n", t, n.vel), ["A2", "F2", "C3", "G2"].flatMap((root, bar) =>
  [0, 7, 12, 7, 0, 7, 12, 7].map((up, i) => ({ time: `${bar}:${i >> 1}:${(i & 1) * 2}`, note: Tone.Frequency(root).transpose(up).toNote(), vel: i % 2 ? 0.45 : 0.75 })),
)).start(0);

// the motif (E D C D, then B A G) from bar 3, sequenced up and answered in B; each note a few ms off the grid
const TUNE: [string, string, string, number][] = [
  ["2:0", "E5", "4n", 0.7], ["2:1", "D5", "8n", 0.55], ["2:1:2", "C5", "8n", 0.6], ["2:2", "D5", "2n", 0.75],
  ["3:0", "B4", "4n.", 0.65], ["3:1:2", "A4", "8n", 0.5], ["3:2", "G4", "2n", 0.6],
  ["4:0", "A5", "4n", 0.8], ["4:1", "G5", "8n", 0.6], ["4:1:2", "F5", "8n", 0.65], ["4:2", "G5", "2n", 0.8],
  ["5:0", "D5", "4n.", 0.7], ["5:1:2", "B4", "8n", 0.55], ["5:2", "D5", "2n", 0.7],
  ["6:0", "E5", "4n", 0.75], ["6:1", "C5", "8n", 0.6], ["6:1:2", "E5", "8n", 0.7], ["6:2", "A5", "2n", 0.9],
  ["7:0", "G#5", "2n.", 0.8], ["7:3", "B4", "4n", 0.6],
];
new Tone.Part((t, n) => flute.triggerAttackRelease(n.note, n.dur, t + n.late, n.vel),
  TUNE.map(([time, note, dur, vel], i) => ({ time, note, dur, vel, late: ((i * 5) % 3 - 1) * 0.007 }))).start(0);

// B: the bass walks up under the climb (F G A, then E to come home), root on one and fifth on three
new Tone.Part((t, n) => bass.triggerAttackRelease(n.note, "4n.", t, n.vel), [["F1", "C2"], ["G1", "D2"], ["A1", "E2"], ["E1", "B1"]].flatMap(([root, fifth], i) => [
  { time: `${4 + i}:0`, note: root, vel: 0.85 },
  { time: `${4 + i}:2`, note: fifth, vel: 0.6 },
])).start(0);

// B: the kit, four bars of sixteenth-note lanes (null rests)
const _ = null;
for (const steps of [
  ["kick", _, _, _, _, _, "kick", _, "kick", _, _, _, _, _, _, _],
  [_, _, _, _, "snare", _, _, _, _, _, _, _, "snare", _, _, _],
  ["hat", _, "ghost", _, "hat", _, "ghost", "ghost", "hat", _, "ghost", _, "hat", _, "ghost", _],
]) {
  const lane = new Tone.Sequence((t, hit) => kit.player(hit).start(t), steps, "16n");
  lane.loop = 4; // set before start: four bars, then it stops
  lane.start("4m");
}

// the button: everything on the end card's downbeat, then nothing
Tone.getTransport().schedule((t) => {
  piano.triggerAttackRelease(["A2", "A3", "C4", "E4"], "2n", t, 0.85);
  bass.triggerAttackRelease("A1", "2n", t, 0.9);
  flute.triggerAttackRelease("A5", "4n", t, 0.8);
  kit.player("kick").start(t);
}, "8m");
Tone.getTransport().start();

// each card is one bar, so every cut lands on a downbeat; the ninth is the end card
const Edit = () => (
  <AbsoluteFill>
    <Mix lufs={-14} ceiling={-1.5} />
    <Series>{Array.from({ length: 9 }, (_, i) => <Series.Sequence key={i} durationInFrames={BAR}>{/* card i */}</Series.Sequence>)}</Series>
  </AbsoluteFill>
);

registerRoot(() => <Composition id="cue" component={Edit} width={1080} height={1920} fps={30} durationInFrames={BAR * 9} />);
```

FluidR3, Salamander and tonejs-instruments (the flute) are CC-BY 3.0, so the piece credits all three (the line is in
each `LICENCE.txt`); VCSL is CC0.

## Example: a game's sound

```tsx
import { AbsoluteFill, Audio, Composition, Mix, Sequence, registerRoot, staticFile, useCurrentFrame, useGameEvents } from "raea";
import * as Tone from "raea/tone";

// the game: its state and step (motion/games); only what the sound reads is shown
type State = { hits: number; coinTaken: boolean };
const INITIAL: State = { hits: 0, coinTaken: false };
const fold = (s: State): State => s;

Tone.getTransport().bpm.value = 112;
Tone.buses.music.duck(Tone.buses.voice, { amount: -12 });
const thump = Tone.vary(new Tone.MembraneSynth({ octaves: 4, maxPolyphony: 4, poly: true }), { pitch: 0.5, volume: 2 }).connect(Tone.buses.sfx);
const coin = new Tone.Sampler({ urls: { C5: Tone.sao("a bright arcade coin chime, short", { seconds: 1 }) } }).connect(Tone.buses.sfx);
// a recorded marimba (`raea sounds get vcsl/marimba`: CC0, every note VCSL sampled, four to seven semitones apart)
const marimba = new Tone.Sampler({
  urls: Object.fromEntries(["F3", "C4", "G4", "B4", "F5"].map((n) => [n, staticFile(`sounds/vcsl-marimba/${n}.wav`)])),
  release: 0.4,
  volume: -10,
}).connect(new Tone.Reverb({ decay: 1.2, wet: 0.15 }).connect(Tone.buses.music));
// a loop that wants to come round: a question (bars 1-2) and its answer (bars 3-4), rhythm before pitch
const tune = new Tone.Part((t, n) => marimba.triggerAttackRelease(n.note, "8n", t, n.vel), [
  { time: "0:0", note: "C4", vel: 0.8 }, { time: "0:0:2", note: "E4", vel: 0.5 }, { time: "0:1:2", note: "G4", vel: 0.6 }, { time: "0:3", note: "A4", vel: 0.7 },
  { time: "1:0", note: "G4", vel: 0.8 }, { time: "1:1:2", note: "E4", vel: 0.5 }, { time: "1:2", note: "D4", vel: 0.6 },
  { time: "2:0", note: "C4", vel: 0.8 }, { time: "2:0:2", note: "E4", vel: 0.5 }, { time: "2:1:2", note: "G4", vel: 0.6 }, { time: "2:3", note: "C5", vel: 0.75 },
  { time: "3:0", note: "B4", vel: 0.7 }, { time: "3:1", note: "G4", vel: 0.55 }, { time: "3:2", note: "C4", vel: 0.85 },
]);
tune.loop = true;
tune.loopEnd = "4m";
tune.start(0);
Tone.getTransport().start();

function Game() {
  const frame = useCurrentFrame();
  const hits = useGameEvents(INITIAL, fold, (b, a) => a.hits > b.hits);
  const coins = useGameEvents(INITIAL, fold, (b, a) => a.coinTaken && !b.coinTaken);
  return (
    <AbsoluteFill>
      <Mix lufs={-14} ceiling={-1.5} />
      {/* ...the game's picture... */}
      <Tone.Sfx when={hits.includes(frame)} play={(t) => thump.triggerAttackRelease("C2", "8n", t)} />
      <Tone.Sfx when={coins.includes(frame)} play={(t) => coin.triggerAttackRelease("C5", "8n", t)} />
      <Sequence from={90} durationInFrames={150} layout="none">
        <Audio src={staticFile("voice.wav")} bus="voice" />
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="game" component={Game} width={1920} height={1080} fps={60} durationInFrames={600} />);
```

`raea/music` is the shorthand for notes on named instruments (`new Part("bass", [...])`, `<Music>`). It plays
through the same Tone layer, so the two mix. Its named instruments are Tone synth presets (`pad` is a PolySynth of
fat saws, `kick` a MembraneSynth), good for a sketch or a test, not a score: write the score on sampled instruments,
as above. It also reads and writes MIDI files (`parseMidi`, `toMidi`; `motion/sources`).
