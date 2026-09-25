---
name: canvas-film
description: >-
  Makes short narrated animated films (30-120s) as one self-contained HTML
  canvas page plus a rendered MP4: script, AI voices, music, sound effects,
  illustrated characters from photos, lip-sync, word-timed gags, render and
  review. Use when asked for an animation, animated short, cartoon, explainer
  or funny video about people or a topic with voiceover and audio, especially
  "pure JavaScript" or "hand-drawn"/"collage" styles. Style packs (collage,
  more to come) live in references. Not for recording a real web page
  (browser-video) or for HyperFrames/Remotion compositions.
---

# Canvas Film

**You cannot hear the film, and a still is not the film.** Every step here
exists to replace a sense you lack: speech-to-text is your ears, stills and
contact sheets are your eyes, and word timestamps are your sense of timing.
Ask of every beat: *which word does this land on, and have I checked it
landed?*

Two rules carry the rest:

1. **Audio first, then pictures.** Lock the voice timeline before animating.
   Every visual beat is anchored to a word (`word("c02", "bail")`), never to a
   typed number, so re-voicing a line moves the gag with it.
2. **One pure `renderAt(t)`.** The page draws any moment from `t` alone. Live
   playback passes `audio.currentTime`; export steps `t = frame / fps`. Nothing
   reads the wall clock, so what you review is what renders.

## Pipeline

All steps run through `scripts/film.py` (EXECUTE; `uv run scripts/film.py
<cmd> <project-dir>`; needs `ffmpeg`, audio steps need `ELEVENLABS_API_KEY`).
The project's `film.json` holds voices, lines, SFX, music and the mix cue
sheet; `src/scenes.js` holds the pictures.

1. **Brief and script.** Budget about 1.8 spoken words per second of runtime:
   a 60s gag-driven film held 111 words once visual beats had room. v3 voices
   read slowly and comic pauses cost time; the first draft of that film ran
   96s. Write lines as the real people would say them; quote the source
   (chat, notes) where you can.
2. **Scaffold:** `film.py init <dir> --style collage` copies
   `assets/engine.html`, `assets/style-collage.js`, `assets/scenes.example.js`
   and `assets/film.example.json` into the project. Then `film.py fonts` with
   the families the style file names.
3. **Voices:** cast per line in `film.json`, then `film.py tts <dir>`. It
   prints each line's transcript: read every one against the script.
4. **Timeline:** `film.py timeline <dir>`. Trims dead air, shortens named
   pauses (`cuts`), applies tempo, overlaps crosstalk (negative `gap`), and
   writes `build/timeline.json` (word times + per-speaker mouth envelopes).
   Iterate lines, cuts and gaps until `END` fits the brief.
5. **Pictures:** characters and props per
   [references/characters.md](references/characters.md); scenes in
   `src/scenes.js` per [references/engine.md](references/engine.md) and the
   style reference.
6. **Music and SFX:** `film.py music <dir>`, `film.py sfx <dir>`, then
   `film.py mix <dir>`.
7. **Review:** `film.py build`, `film.py snap <dir> <t...>` at every beat,
   fix, repeat. Then `film.py render`, `film.py sheet` on the MP4, and
   `film.py stt` on the share file with `--find` for the key words.

Details of each step, with the failures that shaped them:

| When the task involves… | Read |
|---|---|
| Script length, casting, v3 tags, pauses, crosstalk, bleeps, music cues, SFX, mix levels, verifying audio | [references/audio.md](references/audio.md) |
| Turning photos into consistent characters, expressions, lip-sync images, props and backgrounds | [references/characters.md](references/characters.md) |
| Writing scenes: scene contract, anchoring, transitions, freeze frames, canvas traps, performance | [references/engine.md](references/engine.md) |
| Stills, contact sheets, the render, share encode, final checks | [references/review.md](references/review.md) |
| The collage look: prompts, lettering, stamps, marker write-ons, paper, comic devices | [references/style-collage.md](references/style-collage.md) |

## Adding a style

A style is a pair: `assets/style-<name>.js` (drawing helpers, `STYLE` font
defaults, optional `drawCaption`) and `references/style-<name>.md` (image
prompts, palette, devices, pacing). Write both from a film that shipped, not
from imagination, and add the row to the table above.

## Neighbours

HyperFrames and Remotion skills build video from HTML/React compositions with
their own runtimes; this skill hand-rolls canvas for full control of an
illustrated look. `browser-video` records real pages. Image generation is
whatever the environment offers (a gpt-image-2 route worked); the ElevenLabs
skills cover their APIs in depth.
