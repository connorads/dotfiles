# Sources: the local models, sample libraries, effect packs and MIDI, and how to get each onto the Mac

## What to do

- Take each sound from the source that fits its job, and know its licence before it goes in:

  | the job | the source |
  |---|---|
  | an instrument playing a part: piano, strings, brass, woodwinds, mallets, guitars, a drum kit | a sampled library: `raea sounds` first, then the packs below |
  | a timbre no library has ("a bowed saw, close") | TokenSynth, curated (`motion/music`) |
  | an effect, foley, an ambience | a recorded pack or the person's own recordings first; SAO for what none has, in layers (`motion/sound`) |
  | a voice over the picture | `<Speech>` (Pocket TTS, local); a voice model is a `raea gen speech` step, Fish's with the person's own FISH_API_KEY (`motion/gen`) |
  | a drummer's feel | a Groove MIDI performance played on a sampled kit |
  | a melody or harmony to arrange from the public domain | Mutopia, OpenScore |

- Use what raea's licence rule takes: CC0 and public domain, CC-BY (credited), MIT and Apache, and free licences that
  allow a commercial film (Sonniss's, Pixabay's, Mixkit's for its effects). Never a non-commercial (NC),
  no-derivatives (ND), Sampling+, "personal use", share-alike (SA) or GPL source: share-alike and GPL terms can reach
  the film or game made with it. A pack's licence is per pack and sometimes per sound; read its readme and keep it
  beside the files.
- Credit each CC-BY source where the piece is shown (its description or end credits). The line is in the
  `LICENCE.txt` that `raea sounds get` writes, or in the pack's readme.
- Keep a pack fetched by hand in one folder on the Mac, outside any project (`~/Music/raea-sounds/PACK/` with its
  licence file), and copy the files a piece uses into its `media/` (`media/sounds/PACK/`): a render reads only its
  own media, never a URL. With the raea app open, `raea library new sounds` and `raea library add sounds
  ~/Music/raea-sounds` index that folder once the person says yes in the app; then `raea library search "metal door
  slam" --kind audio --sound` finds a sound by what it sounds like.
- raea reads WAV, MP3, FLAC and AAC (.m4a). Convert Ogg (most of Kenney's packs) and Opus to WAV first (`ffmpeg -i
  in.ogg out.wav`).

## Getting SAO and TokenSynth onto the Mac

Both run on this computer and install themselves the first time a render, `raea sao` or `raea tokensynth` asks for
a sound. To do it ahead of time and see where they are:

```sh
raea setup-audio --check   # what's installed, where, and how much disk
raea setup-audio           # installs what's missing: TokenSynth, then SAO
raea setup-audio sao       # one of them
```

- **What it fetches.** Each model has a script (`TOOLS/sao/setup.sh` and `TOOLS/tokensynth/setup.sh`; TOOLS is
  `tools/` in a raea checkout, `share/raea/tools/` beside an installed raea) that installs into `~/.cache/raea-sao`
  and `~/.cache/raea-tokensynth` (RAEA_SAO and RAEA_TOKENSYNTH move them):
  - SAO, about 2 GB: Stable Audio Open Small's Core ML conversion (the DiT, the VAE decoder and the number embedder)
    from a Hugging Face mirror at a pinned revision, each file checked against its SHA-256; t5-base's tokenizer; a
    small Python environment; and raea's own fp32 T5 encoder, converted once in a throwaway environment whose torch
    and t5-base weights (about 900 MB) are deleted after.
  - TokenSynth, about 6 GB: its code from GitHub, a Python environment with torch (about 1.1 GB), the model and its
    unconditional twin (713 MB each), DAC (307 MB) and CLAP (2.35 GB) from Hugging Face, the text encoders CLAP
    fetches, then a converted fp16 runtime and Core ML models.
- **What it needs.** A network connection, `uv` (Astral's Python manager) and, for TokenSynth, `git`, which the
  scripts take from the PATH. On a Mac without them, `TOOLS/ensure.sh` gets raea's pinned builds (uv 0.12.24 and git
  2.56.0, under `~/.cache/raea-tools`, each download checked against its SHA-256) and prints the program's path. Put
  both on the PATH for the setup:

  ```sh
  B=$(dirname "$(realpath "$(command -v raea)")"); T=$B/../share/raea/tools; [ -d "$T" ] || T=$B/../../tools  # an install, or a checkout
  PATH="$(dirname "$(bash "$T/ensure.sh" uv)"):$(dirname "$(bash "$T/ensure.sh" git)"):$PATH" raea setup-audio
  ```

- **The licences.** TokenSynth's code and weights are MIT. Stable Audio Open Small is under Stability AI's Community
  License (stability.ai/community-license-agreement), which isn't an open licence. As between the person and
  Stability, the person owns the sounds it makes, as far as the law allows; the sounds may not be used to create or
  improve another generative AI model, and Stability's acceptable use policy applies to them. The licence's other
  duties fall first on raea, which hands the model on: a copy of the agreement and a notice file beside the model,
  "Powered by Stability AI" where raea documents it, and registering raea's own commercial use. raea hasn't settled
  those yet, nor what is left for the person (docs/sound.feature SN2), so don't tell the person what the licence asks
  of them: before the first SAO sound goes into a commercial piece of theirs, say the model is under that licence,
  give them the link and let them decide, or take that sound from a recorded pack instead.
- **When it fails.** The error names the script and the folder; run that script with `sh` to see its own output.
  `exit status: 127` is uv not found. On a Mac without the Command Line Tools, `/usr/bin/git` is only a stub: it
  opens an install dialog, and the setup stops with status 1 and `xcrun: error: invalid active developer path`. Use
  the git `ensure.sh` installs (above). `75` is another setup running in the same folder: wait for it, or remove the
  folder's `.setup-lock` once nothing is running. RAEA_OFFLINE refuses the download. RAEA_AUDIO_AUTOSETUP=0 turns
  the self-install off, so a render names the command instead; it also stops `raea setup-audio` and `ensure.sh`, so
  with it set, run the model's script yourself (`sh TOOLS/sao/setup.sh`). Running setup-audio again picks up where a
  broken install stopped: finished files are kept.
- A render that meets a model not yet installed waits while it installs (minutes, once). Run setup-audio before the
  first render, not inside one.

## What `raea sounds` fetches for you

`raea sounds WORDS` searches four libraries with no network (`kick`, `hihat` and the other words producers use find
their parts). `raea sounds get PACK/INSTRUMENT` downloads one instrument's files once (into `~/.cache/raea-sounds`),
copies them into `media/sounds/PACK-INSTRUMENT/` with a `LICENCE.txt`, and prints the `Sampler` (or the `Player`s)
that plays them.

| pack | licence | what it has |
|---|---|---|
| `salamander` | CC-BY 3.0 (credit) | a grand piano, sampled every minor third |
| `fluid` | CC-BY 3.0 (credit) | the 128 General MIDI instruments of the FluidR3 font, every note A0 to C8; no drum kit |
| `tonejs-instruments` | CC-BY 3.0 (credit) | 20, recorded from VSCO 2, the University of Iowa, Karoryfer and Freesound: cello, violin, contrabass, French horn, trumpet, trombone, tuba, saxophone, flute, clarinet, bassoon, harp, three guitars (acoustic, electric, nylon), electric bass, organ, harmonium, piano, xylophone |
| `vcsl` | CC0 | 104 from the Versilian Community Sample Library: pianos, harpsichords, harps, organs, recorders, marimba, vibraphone, glockenspiel, kalimbas; bass drums, snares, toms, hi-hat, cymbals, claps, shakers, congas, timpani; a siren, a ratchet, an anvil and other effects |

The ids are exact: `raea sounds kick` lists `vcsl/bass-drum-1`, and `vcsl/bass-drum` isn't one. A pitched
instrument comes as one take a note, at its middle dynamic: with no `--notes`, roots at least a minor third apart from
C1 to C7, the ones a Sampler needs, named as notes with sharps written `s` (`Ds3.mp3` is D#3). A drum or a hit comes
as its first 12 takes (`--all` for every one). VCSL names a hit's dynamic and round robin in the file (a higher `_vN`
is a harder hit, `_rr1`, `_rr2` the round robins), so a part can pick a softer take for a softer note.

## Packs to fetch by hand

Each goes into its own folder in `~/Music/raea-sounds/`, with its licence file beside it; the files a piece uses are
then copied into its `media/`. These have a stable address, so one command fetches each (`git` is the one
`TOOLS/ensure.sh git` prints on a Mac without the Command Line Tools):

```sh
P=~/Music/raea-sounds
# VSCO 2 CE, the orchestra with its SFZ maps: 3.2 GB, CC0 (LICENSE inside)
git clone --depth 1 --branch SFZ https://github.com/sgossner/VSCO-2-CE "$P/vsco2-ce"
# VCSL, every dynamic and round robin, with SFZ maps: 6.2 GB, CC0 (the sfz branch has no LICENSE, so it's fetched beside)
git clone --depth 1 --branch sfz https://github.com/sgossner/VCSL "$P/vcsl" && curl -fsSL -o "$P/vcsl/LICENSE" https://raw.githubusercontent.com/sgossner/VCSL/master/LICENSE
# Salamander Grand Piano V3, 16 velocities: 0.75 GB, CC-BY 3.0 (LICENSE inside)
git clone --depth 1 https://github.com/sfzinstruments/SalamanderGrandPiano "$P/salamander-v3"
# Groove MIDI, the MIDI only: 3.1 MB, CC-BY 4.0, checked against the SHA-256 its page gives
mkdir -p "$P/groove" && curl -fL -o "$P/groove/groove-midionly.zip" https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip \
  && echo "651cbc524ffb891be1a3e46d89dc82a1cecb09a57c748c7b45b844c4841dcc1e  $P/groove/groove-midionly.zip" | shasum -a 256 -c \
  && unzip -q "$P/groove/groove-midionly.zip" -d "$P/groove" \
  && echo "Groove MIDI Dataset (Google Magenta), CC-BY 4.0: magenta.tensorflow.org/datasets/groove" > "$P/groove/LICENCE.txt"
# MuseScore General, a General MIDI bank with drum kits: 40 MB as SF3, MIT, with its licence and notices
mkdir -p "$P/musescore-general" && curl -fL --output-dir "$P/musescore-general" \
  -O https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3 \
  -O https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md
```

The rest are picked a pack or a sound at a time on their own pages. `raea sounds get` reaching all of them is filed
as docs/sound.feature SN4.

| source | licence | where | what it has |
|---|---|---|---|
| VSCO 2 Community Edition | CC0 | github.com/sgossner/VSCO-2-CE (its `SFZ` branch has the maps) | an orchestra: solo and section strings with articulations, woodwinds, brass, percussion, keys; WAV with SFZ maps |
| VCSL, the whole library | CC0 | github.com/sgossner/VCSL (its `sfz` branch has the maps) | every dynamic and round robin of what `raea sounds` gives one take of |
| Salamander Grand Piano V3 | CC-BY 3.0 | github.com/sfzinstruments/SalamanderGrandPiano | the same piano at 16 velocities, 48 kHz, SFZ |
| sfzinstruments' lists | per pack, on the list | sfzinstruments.github.io (pianos, strings, drums) | take the CC0, public domain and CC-BY ones: Karoryfer's free packs (Big Rusty, Swirly and Unruly drums, Frankensnare, Meatbass, Bigcat Cello; mostly CC0, older ones CC-BY 3.0: read each readme), SM Drums (public domain), Splendid Grand Piano (public domain), DrumGizmo's DRS and Muldjord kits and Naked Drums (CC-BY 4.0) |
| University of Iowa Musical Instrument Samples | "may be downloaded and used for any projects, without restrictions" | theremin.music.uiowa.edu/mis.html | single notes of orchestral instruments at several dynamics, recorded dry: give them a room's reverb |
| FreePats | per bank: CC0, CC-BY or GPL; take the CC0 and CC-BY banks only | freepats.zenvoid.org | General MIDI families, world instruments, percussion; SFZ and SF2 |
| MuseScore General | MIT (keep its notices) | ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/ | a General MIDI bank with drum kits, SF2 (216 MB) or SF3 (40 MB), for playing a MIDI file as it is |
| Kenney's audio packs | CC0 | kenney.nl/assets/category:Audio | Impact Sounds, Interface Sounds, UI Audio, Sci-fi Sounds, RPG Audio, Casino Audio, Digital Audio, Music Jingles, voice-over packs; mostly Ogg |
| OpenGameArt | per asset: take CC0, CC-BY and OGA-BY | opengameart.org | game effects and loops, such as "512 Sound Effects (8-bit style)" (CC0) |
| Freesound | per sound: take CC0 and CC-BY only | freesound.org (a free account to download) | field recordings, foley and effects of every kind |
| Sonniss #GameAudioGDC bundles | royalty-free for commercial use, no credit; never passed on as sounds (a library, a pack, a template) and never used to train a model | sonniss.com/gameaudiogdc | over 200 GB of professional foley, impacts, ambiences and field recordings, a bundle a year |
| Pixabay sound effects | Pixabay's Content License: free, commercial use, no credit; never sold or shared on their own | pixabay.com/sound-effects | effects and ambiences |
| Mixkit sound effects | Mixkit's Sound Effects Free License: free, commercial use (games and broadcast too), no credit; never passed on on their own (as stock, in a tool or a template) and never registered with a rights service such as Content ID | mixkit.co/free-sound-effects | effects, whooshes, interface sounds, ambiences |
| Groove MIDI Dataset | CC-BY 4.0 (credit Google Magenta) | magenta.tensorflow.org/datasets/groove | 1,150 MIDI performances by 10 drummers: 13.6 hours of beats and fills in 18 styles |
| Mutopia Project | per piece: public domain or CC-BY (skip the BY-SA ones) | mutopiaproject.org | 2,100 classical pieces as MIDI and LilyPond |
| OpenScore Lieder | CC0 | github.com/OpenScore/Lieder | 1,350 art songs as MuseScore scores (MuseScore exports MIDI) |

Not these, whatever they sound like: Sonatina Symphonic Orchestra and the Virtual Playing Orchestra (Sampling+ and
mixed terms: no use in an ad), the Philharmonia's samples (terms unclear), Spitfire LABS (no samples to take), the
MusyngKite and FatBoy fonts beside FluidR3 (CC BY-SA 3.0: share-alike), FreePats' GPL banks (copyleft), Tone.js's
own drum kits (CC BY-NC-SA), the BBC's sound effects (personal and research use), Zapsplat (its own terms), Mixkit's
stock music (not in games or broadcasts, and no remixing), Salamander Drumkit and other CC-BY-SA kits, and Lakh MIDI
(copyrighted songs). Freesound's API is free only for non-commercial use, so raea doesn't search Freesound for the
person: they download its sounds themselves.

## Loading a pack in a composition

- **One-shots** (an effect pack, a field recording): the file in `media/sfx/PACK/`, then `<Audio
  src={staticFile("sfx/PACK/door-slam.wav")} />` in a Sequence at its frame (`motion/sound`), or a `Tone.Player`
  for a game's one-shot.
- **A multisampled instrument** (the SFZ packs): raea has no SFZ reader yet. The `.sfz` file is text: each `<region>`
  names a `sample=` file, its `pitch_keycenter` (the note it is), `lovel`/`hivel` (the velocities it plays) and
  `seq_position` (its round robin). Copy the files for the notes and dynamics the part needs, map them by note, and
  give each dynamic its own Sampler, picked by the note's velocity:

  ```tsx
  // SOFT and LOUD: { C3: staticFile("sounds/vsco-cello/..."), ... }, written from the .sfz's regions
  const soft = new Tone.Sampler({ urls: SOFT, release: 0.6 }).connect(Tone.buses.music);
  const loud = new Tone.Sampler({ urls: LOUD, release: 0.6 }).connect(Tone.buses.music);
  const cello = (note: string, dur: string, t: number, vel: number) => (vel < 0.6 ? soft : loud).triggerAttackRelease(note, dur, t, vel);
  ```

- **A MIDI file** (a Groove MIDI performance, a Mutopia piece): turned into JSON and played on Samplers and Players
  (below).
- **A SoundFont** (`.sf2`, `.sf3`): raea can't play one. To hear a MIDI file the person hands over as it is, render
  it with FluidSynth (`brew install fluid-synth`, then `fluidsynth -ni -F song.wav -r 48000 MuseScore_General.sf3
  song.mid`) and play the WAV as `<Audio bus="music">`; to write parts, use the sampled libraries instead.

## A MIDI file in a composition

A Groove MIDI performance or a Mutopia piece comes as a `.mid`. raea/music reads one (`parseMidi`, in
sdk/audio/src/midi.ts), and the raea app imports a `.mid` into a listen item's Part, but a composition can't import
a `.mid` yet (docs/sound.feature SN6). Turn it into JSON in raea/music's `MidiFile` shape (`tracks[].notes[]` with
`midi`, `time` and `duration` in seconds, and `velocity` 0 to 1), each note from its note-on to its note-off, one
track per channel; a composition imports that, and its code stays the same when a `.mid` can be imported:

```sh
uv run -q --no-project --with mido python3 -I - media/grooves/funk-92.mid media/grooves/funk-92.json <<'PY'
import json, sys, mido
f = mido.MidiFile(sys.argv[1])
tempo, ticks, secs, held, tracks, tempos, sigs = 500000, 0, 0.0, {}, {}, [], []
def end(ch, note, at, t, v):  # one note, from its note-on to now, as raea/music's MidiNote
    tracks.setdefault(ch, []).append({"midi": note, "time": round(at, 4), "duration": round(secs - at, 4), "velocity": round(v / 127, 3), "ticks": t, "durationTicks": ticks - t})
for m in mido.merge_tracks(f.tracks):
    ticks += m.time
    secs += mido.tick2second(m.time, f.ticks_per_beat, tempo)
    if m.type == "set_tempo":
        tempo = m.tempo
        tempos.append({"ticks": ticks, "bpm": round(mido.tempo2bpm(m.tempo), 3)})
    elif m.type == "time_signature":
        sigs.append({"ticks": ticks, "timeSignature": [m.numerator, m.denominator]})
    elif m.type == "note_on" and m.velocity:
        held.setdefault((m.channel, m.note), []).append((secs, ticks, m.velocity))
    elif m.type in ("note_on", "note_off") and held.get((m.channel, m.note)):
        end(m.channel, m.note, *held[(m.channel, m.note)].pop(0))
for (ch, note), left in held.items():  # still sounding when the file ends
    for n in left:
        end(ch, note, *n)
out = [{"name": f"channel {ch + 1}", "channel": ch, "notes": sorted(ns, key=lambda n: n["time"])} for ch, ns in sorted(tracks.items())]
json.dump({"header": {"ppq": f.ticks_per_beat, "tempos": tempos, "timeSignatures": sigs, "name": ""}, "tracks": out, "duration": round(secs, 4)}, open(sys.argv[2], "w"))
PY
```

A drum track plays on a kit of Players by note number. Groove MIDI was recorded on a Roland kit, whose map differs
from General MIDI's: its hi-hat edge hits are 22 (closed) and 26 (open), notes General MIDI doesn't have, so a
General MIDI map drops many of its hi-hats:

```tsx
import groove from "./media/grooves/funk-92.json"; // seconds, at the drummer's 92 bpm
// Roland's drum map (the dataset's page lists the toms and cymbals): 36 kick; 37, 38 and 40 snare (cross-stick,
// head, rim); 42, 22 and 44 closed hi-hat (bow, edge, pedal); 46 and 26 open hi-hat (bow, edge)
const KIT: Record<number, string> = { 36: "kick", 37: "snare", 38: "snare", 40: "snare", 42: "hat", 22: "hat", 44: "hat", 46: "open", 26: "open" };
const kit = new Tone.Players({
  kick: staticFile("sounds/vcsl-bass-drum-1/BDrumNew_hit_v5_rr1_Sum.wav"),
  snare: staticFile("sounds/vcsl-snare-drum-modern-1/Snare2_HitSN_v5_rr1_Mid.wav"),
  hat: staticFile("sounds/vcsl-hi-hat-cymbal/HiHat_HitC_v3_rr1_Mid.wav"),
  ghost: staticFile("sounds/vcsl-hi-hat-cymbal/HiHat_HitC_v1_rr1_Mid.wav"),
  open: staticFile("sounds/vcsl-hi-hat-cymbal/HiHat_HitO_rr1_Mid.wav"),
}).connect(Tone.buses.music);
const stretch = 92 / Tone.getTransport().bpm.value; // the drummer's tempo onto the cue's
const hits = groove.tracks.flatMap((track) => track.notes).filter((n) => n.midi in KIT);
// a soft closed hat plays the soft take
new Tone.Part((t, n) => kit.player(KIT[n.midi] === "hat" && n.velocity < 0.45 ? "ghost" : KIT[n.midi]).start(t), hits.map((n) => ({ ...n, time: n.time * stretch }))).start("4m");
```

A pitched track (a Mutopia piece) plays on a Sampler, one Part a track, each note at its own length:
`piano.triggerAttackRelease(Tone.Frequency(n.midi, "midi").toNote(), n.duration * stretch, t, n.velocity)`.
