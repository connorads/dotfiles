# Sound and music

Everything heard: voice, the music bed, foley, a game's one-shots, instruments written for picture, and the mix. The
files under `motion/` and `3d/` are copies of raea's craft guides (`raea guide NAME` prints the same text).

## Which file to open

| You are... | Open |
|---|---|
| a voice, a bed, foley on beats, gains, fades, the music bus, the master | [motion/sound.md](motion/sound.md) |
| writing music for picture with Tone.js (`raea/tone`): instruments, a bed cut on the bar | [motion/music.md](motion/music.md) |
| generated sound and sample libraries, by import and by path | [motion/assets.md](motion/assets.md) |
| cutting to a song's energy rather than a constant BPM | [motion/timing.md](motion/timing.md) ("Pacing cuts to a song's energy") |
| a game's sound: one-shots on transitions, buses, a bed ducked under a voice | [3d/games.md](3d/games.md) (Sound), [motion/games.md](motion/games.md) |
| sound placed in a 3D room (`Sound3D`) | [3d/rooms.md](3d/rooms.md) |
| a note about the mix ("the music's too loud") | [craft/verbs/quieter.md](craft/verbs/quieter.md), [craft/verbs/bolder.md](craft/verbs/bolder.md) |

## The verbs

All HEADLESS and local on the Mac (`raea setup-audio` installs the local models the first time, `--check` says
whether they're there):
- `raea sao "PROMPT"`: foley.
- `raea tokensynth "TIMBRE" --notes C2,C3,C4`: an instrument's notes, to build a library from (a take isn't trusted;
  [motion/music.md](motion/music.md) says why).
- `raea sounds [WORDS]`, `raea sounds get PACK/INSTRUMENT`: open sample libraries for a Sampler.
- `raea song FILE`: a song's energy map (beats, sections, builds, drops) to cut to.
- `raea media loudness FILE`: the mix's loudness against a delivery spec.
- `raea gen music|sfx|speech "PROMPT"`: generated audio from a provider ([gen.md](gen.md)).

## Checks

[motion/sound.md](motion/sound.md)'s "Check the sound before you call it done", and the controllers' loudness spec
when the workspace sets one ([delivery.md](delivery.md)).
