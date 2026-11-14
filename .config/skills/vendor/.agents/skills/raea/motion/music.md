# Music and sound effects: Tone.js on raea (raea/tone)

## What to do

- Write music and sound effects in Tone.js, as its docs write them: `import * as Tone from "raea/tone"`, then
  instruments, effects, `connect`/`toDestination`/`chain`, `triggerAttackRelease`, and the Transport with `Loop`,
  `Part`, `Sequence` and `Pattern`. What you know of Tone works; the differences are below. It's a DAW in code: a
  track is an instrument and its effects into a bus, a clip is a `Part` or `Sequence`, the arrangement is where each
  starts and stops on the Transport.
- Make music from instruments, not from a generated track. Each instrument is a `Tone.Sampler`; fill it one of two
  ways, both local and free:
  - **TokenSynth** for an instrument described in words: `Tone.tokensynth("a warm upright bass, plucked", ["C2",
    "C3", "C4"], { seconds: 2 })` renders those root notes once on this computer, and the Sampler pitches between
    them. Describe the timbre the way you'd describe a patch ("a soft wooden marimba, felt mallet, warm"; "a bright
    analog synth lead, saw, short decay"). Three roots an octave apart cover a part; a note's `seconds` is how long
    it's held (under 5). Each root takes about 5 s to make the first time, then it's cached.
  - **A sample library** for a real recorded instrument: `raea sounds piano` searches the open libraries (the
    Salamander grand piano, the 128 General MIDI instruments, tonejs-instruments' orchestra, the Versilian library's
    orchestral, world and percussion instruments); `raea sounds get salamander/piano` copies its notes into
    `media/sounds/` and prints the `Sampler` that plays them. Drums and hits come as takes for `Tone.Player`s.
  - Tone's own synths (`Synth`, `PolySynth`, `MembraneSynth`, `MetalSynth`, `NoiseSynth`, `FMSynth`) are there for
    pads, kicks, risers and anything synthetic.
- Make sound effects and foley with SAO: `Tone.sao("a bright arcade coin chime, short", { seconds: 1 })` in a
  Sampler or Player, or `sao(...)` in an `<Audio>` (`motion/sound`). Narration over the picture is
  `<Speech>` from `raea/speech` (Pocket TTS, local; `motion/sound`).
- Build the graph at the top level of the file: every instrument, effect and channel, and how they connect. The graph
  is the one the composition has when its first frame renders. Schedule notes with the Transport (or with explicit
  times). Never trigger notes from inside a component's render: a game's one-shots go through `<Tone.Sfx>`.
- Time 0 is the composition's first frame. `Tone.now()` is 0 at the top level and the event's time inside a callback,
  so `Tone.getTransport().start()` at the top level starts the music at frame 0. Every note lands on its own sample,
  so a render and a play are the same.
- Route through the buses: `Tone.buses.music`, `.sfx`, `.voice`, `.ambience`, `.ui`. Connect Tone nodes to them, and
  give `<Audio>` and `<Video>` a `bus="voice"` (or another bus) prop. Each bus is a Tone `Channel`: `volume`, `pan`,
  `mute`, `solo`, `send`/`receive`.
- Duck the bed under the voice with `Tone.buses.music.duck(Tone.buses.voice, { amount: -12 })`; do the same for
  ambience. Start at -10 to -14 dB, 40 ms attack and 300 to 400 ms release. Then listen.
- Keep one `<Mix lufs={-14} ceiling={-1.5} />` per composition. The master measures the whole core, Tone included.
- In a game, fire a one-shot on the exact frame something happens: `<Tone.Sfx when={...} play={(t) => ...} />` with
  `when` from `useGameEvents` or a machine's transition. Give one-shots `Tone.vary(instrument, { pitch: 0.3,
  volume: 2 })` so repeats don't sound copied (the variation is seeded by the frame, so a replay is the same). Cap
  their voices with `maxPolyphony` (the oldest is stolen, faded in 5 ms).
- In a timeline, cut on the music: `Tone.Time("1m").toFrames(fps)` is a bar in frames, and `Tone.Time("4n")` a beat.
- To hear a sound before writing it in, `raea sao "PROMPT" --seconds 1 -o media/sfx/try.wav` or `raea tokensynth
  "TIMBRE" --notes C3 -o media/try/` makes it now; the edit's own call with the same words and settings then plays
  what was made instead of making it again.

## Instruments from TokenSynth: build a library, don't trust a take

A TokenSynth note is one sample from a model, and a lot of takes are bad. In a 35-minute documentary score (2026-10-20),
12 of 30 single-seed root notes failed: hiss and buzz in place of a horn, a sax or accordion an octave (or 34
semitones) off, a piano note still at full level when its file ends, so every held note stopped with a click. That is
the "vanilla and abrasive" sound. So:

- Reach for an open sample library first for a standard instrument (`raea sounds piano`, `sounds get
  salamander/piano`): recorded, velocity-layered, no gamble. Use TokenSynth for what no library has, or a timbre you
  can describe better than find.
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

## Writing music for picture

- Write for the picture's mood, not a genre's surface. A walking bass, brushes and block chords on every bar reads as
  MIDI pastiche. Under narration, a drone score works: a chord every four bars, bass and a sine sub swelling under it,
  a sustained section with a slow attack, and a piano playing single notes off any grid, with a motif returning in
  fragments. Sustained textures also hide what's left of a sample's flaws.
- Leave silence. Let the music start after a chapter card clears and stop before the next; let a card sit on one low
  note.
- Soften the whole bed: a 24 dB/octave low-pass around 2.5 kHz into a long reverb (decay 6 to 7 s) on the music bus.
  The voice owns the presence range.
- Duck gently under a voice over a drone (-6 to -8 dB, 80 ms attack, about 0.9 s release); the -12 dB duck suits a
  rhythmic bed, where pumping is less audible.
- Period source music can be real: US sound recordings published before 1926 and compositions published before 1931
  are public domain in the US (2026). archive.org's 78rpm transfers give the period's own sound; play them as
  `<Audio bus="music">` under the score's drones, ducked with the rest.
- Synth drums (`MembraneSynth` kicks, noise "brushes") sound synthetic on anything acoustic; leave them out or use a
  library's recorded kit.

## Why

Tone code here builds an edit's graph and an event list instead of driving Web Audio. The Transport's callbacks run in
time order as frames need them, and the one mixer core plays each event on its own sample. That makes a render
and a play of the same frames identical, and the same holds after a seek. A node made later than the first frame
rebuilds the graph (a pause in the sound), and a note triggered while rendering would fire again on every re-render.
So the graph goes at the top level, and in-game sounds go through `<Sfx>`.

Generated sources are made once per their inputs: the prompt, the length, a TokenSynth note's pitch, velocity, seed
and precision. They're normalised, cached as PCM in the object's `assets/`, and played like any file. TokenSynth and
SAO run on this computer and install themselves the first time they're used (a few minutes, once). Music written as
notes on instruments can be edited note by note, cut on the bar and ducked per part; a generated track can't.

Policy: music is Tone.js instruments (TokenSynth, the sample libraries, synths), foley and effects are SAO, narration
is Pocket TTS (`<Speech>`), all local. No other generation: no generated images, video or remote sound effects. (`lyria()`, a remote music model, is
retired: an older edit keeps the take it made, and a new one is refused.)

## Common mistakes

- `synth.triggerAttackRelease(...)` in a component body. It fires on every render; use `<Tone.Sfx>`.
- `new Tone.Synth()` inside a component. Make instruments at the top level.
- A `https://` URL for a Sampler or a Player. Sources are media files or generated assets, and the render has no
  network: `raea sounds get` puts a library's files in `media/` first.
- One TokenSynth root for a whole part. A Sampler stretched three octaves from one note sounds chipmunked or
  muddy; give it a root every octave (or `raea sounds get` a library's roots, a minor third apart).
- Rewording a `tokensynth()` timbre on every pass: each new wording makes its notes again. Settle the timbre first.
- A sample library's licence ignored. CC-BY ones (FluidR3, Salamander) need their credit where the piece is shown;
  `LICENCE.txt` beside the files has the line. VCSL is CC0.
- `Tone.Draw.schedule` for visuals. There's no draw loop: read the frame (`useCurrentFrame`) and the same times.
- Cutting on `Tone.Time("1m").toFrames(fps)` across a tempo ramp. `Tone.getTransport().bpm.rampTo(120, 4)` bends the
  grid, as in Tone (the notes come closer together; an exponential ramp runs linear), but `Time(...)` is at the tempo
  when it's read, so after a ramp a bar is no longer that many frames.
- An LFO on an instrument's parameter (a synth's `detune`, a Sampler's `volume`): it does nothing yet. On an effect's
  or a `Gain`'s, `Volume`'s or `Channel`'s it works, as in Tone (`new Tone.LFO("4n", 400, 4000).start()
  .connect(filter.frequency)`).
- A Sequence or Loop with no `Tone.getTransport().start()`. Nothing plays until the Transport starts, as in Tone.

## Example: a bed from TokenSynth instruments and a library piano, cut on the bar

`raea sounds get salamander/piano --notes C3,C4,C5` put the piano's notes in `media/sounds/salamander-piano/`.

```tsx
import { AbsoluteFill, Composition, Mix, Series, registerRoot, staticFile } from "raea";
import * as Tone from "raea/tone";

Tone.getTransport().bpm.value = 92;
const BAR = Tone.Time("1m").toFrames(30); // 78 frames at 92 bpm in 4/4
const room = new Tone.Reverb({ decay: 2.2, wet: 0.25 }).connect(Tone.buses.music);
const bass = new Tone.Sampler({ urls: Tone.tokensynth("a warm upright bass, plucked, round", ["C2", "C3"], { seconds: 1.5 }), release: 0.3 }).connect(Tone.buses.music);
const keys = new Tone.Sampler({
  urls: { C3: staticFile("sounds/salamander-piano/C3.mp3"), C4: staticFile("sounds/salamander-piano/C4.mp3"), C5: staticFile("sounds/salamander-piano/C5.mp3") },
  release: 1.2,
  volume: -8,
}).connect(room);
const kick = new Tone.MembraneSynth({ octaves: 5, volume: -8 }).connect(Tone.buses.music);
new Tone.Sequence((t, n) => kick.triggerAttackRelease(n, "8n", t), ["C1", null, null, null], "4n").start(0);
new Tone.Part((t, n) => bass.triggerAttackRelease(n, "4n", t), [["0:0", "A2"], ["0:2", "E2"], ["1:0", "F2"], ["1:2", "C3"]]).start(0);
new Tone.Part((t, c) => keys.triggerAttackRelease(c, "2n", t), [["0:0", ["A3", "C4", "E4"]], ["1:0", ["F3", "A3", "C4"]]]).start(0);
Tone.getTransport().start();

// each card is one bar long, so every cut lands on a downbeat
const Edit = () => (
  <AbsoluteFill>
    <Mix lufs={-14} ceiling={-1} />
    <Series>{[0, 1, 2, 3].map((i) => <Series.Sequence key={i} durationInFrames={BAR}>{/* card i */}</Series.Sequence>)}</Series>
  </AbsoluteFill>
);

registerRoot(() => <Composition id="bed" component={Edit} width={1080} height={1920} fps={30} durationInFrames={BAR * 4} />);
```

## Example: a game's sound

```tsx
import { AbsoluteFill, Audio, Composition, Mix, Sequence, registerRoot, staticFile, useCurrentFrame, useGameEvents, useGameState } from "raea";
import * as Tone from "raea/tone";

// the game: its state and step (motion/games); only what the sound reads is shown
type State = { hits: number; coinTaken: boolean };
const INITIAL: State = { hits: 0, coinTaken: false };
const fold = (s: State): State => s;

Tone.buses.music.duck(Tone.buses.voice, { amount: -12 });
const thump = Tone.vary(new Tone.MembraneSynth({ octaves: 4, maxPolyphony: 4, poly: true }), { pitch: 0.5, volume: 2 }).connect(Tone.buses.sfx);
const coin = new Tone.Sampler({ urls: { C5: Tone.sao("a bright arcade coin chime, short", { seconds: 1 }) } }).connect(Tone.buses.sfx);
const marimba = new Tone.Sampler({ urls: Tone.tokensynth("a soft wooden marimba, felt mallet, warm", ["C3", "C4", "C5"], { seconds: 2 }), volume: -10 }).connect(Tone.buses.music);
const tune = new Tone.Part((t, n) => marimba.triggerAttackRelease(n, "8n", t), [["0:0", "C4"], ["0:1", "E4"], ["0:2", "G4"], ["1:0", "A4"], ["1:2", "G4"]]);
tune.loop = true;
tune.loopEnd = "2m";
tune.start(0);
Tone.getTransport().start();

function Game() {
  const frame = useCurrentFrame();
  const g = useGameState(INITIAL, fold);
  const hits = useGameEvents(INITIAL, fold, (b, a) => a.hits > b.hits);
  return (
    <AbsoluteFill>
      <Mix lufs={-14} ceiling={-1.5} />
      {/* ...the game's picture... */}
      <Tone.Sfx when={hits.includes(frame)} play={(t) => thump.triggerAttackRelease("C2", "8n", t)} />
      <Tone.Sfx when={g.coinTaken} play={(t) => coin.triggerAttackRelease("C5", "8n", t)} />
      <Sequence from={90} durationInFrames={150} layout="none">
        <Audio src={staticFile("voice.wav")} bus="voice" />
      </Sequence>
    </AbsoluteFill>
  );
}
```

`raea/music` is the shorthand for notes on named instruments (`new Part("bass", [...])`, `<Music>`). It plays
through the same Tone layer, so the two mix.
