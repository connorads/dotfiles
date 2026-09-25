# Audio

Voices, timeline, music, SFX, mix, and how to check audio you cannot hear.
Everything here was observed making a 61s film (2026-09-25) with ElevenLabs
`eleven_v3`, `music_v2`, `eleven_text_to_sound_v2` and `scribe_v2`.

## Contents

- Script and casting
- `film.json` line fields
- Timeline: trimming, tempo, crosstalk
- Bleeps
- Music
- Sound effects
- Mix
- Checking audio with speech-to-text

## Script and casting

- Cast from `GET /v1/voices` by accent, age and delivery; record the voice
  name, id and why in the project (the ElevenLabs text-to-speech skill has
  the casting rules). A deep mature British narrator suits a mock nature
  documentary; give each other character a distinct voice so crosstalk
  separates.
- v3 audio tags (`[whispers]`, `[sighs]`, `[laughs]`, `[excited]`,
  `[apologetic]`, `[dramatic]`) shaped delivery and were never read aloud in
  25 lines. `[short pause]` and `...` both produce long pauses; budget for
  them or cut them in the timeline.
- Write numbers and dates as the viewer should hear them ("the fifteenth",
  "Eight p.m."); `apply_text_normalization: on` handles the rest.
- Swearing for comedy: voice the real word, then bleep it from the word
  timestamps. It lands better than a written "beep" and keeps the rhythm.

## `film.json` line fields

```json
{ "id": "c01", "speaker": "alex", "text": "Twenty-second might work. Twenty-fourth doesn't.",
  "gap": -1.6, "cuts": { "work": 0.35 }, "skip": "Next", "tempo": 1.04 }
```

- `gap`: seconds after the previous line ends (default 0.25). Negative
  overlaps: -1.1 to -1.6 gave a crosstalk montage that Scribe still
  transcribed word for word.
- `cuts`: `{word: seconds}` shortens the pause *after* that word to at most
  the given length. Leave comic pauses alone (the beat before a punchline).
- `skip`: start the clip at this word (trims a preamble without re-voicing).
- `tempo`: per line; film-level `"tempo": {"narrator": 1.07, "*": 1.04}`
  sets defaults. 1.04-1.07 kept every word transcribable.

`film.py tts` generates with timestamps and then transcribes each clip; the
Scribe word times drive everything downstream (they are tighter than the TTS
alignment, which includes the tag spans).

## Timeline

`film.py timeline` prints each line's start and end and the total. Fit the
brief here, before any pictures exist. Moves that bought time, in order of
harmlessness: trim named dead pauses, tighten gaps to 0.15-0.25s, tempo
1.04-1.07, overlap crosstalk, cut a line's preamble with `skip`, rewrite a
line shorter, drop a line. Re-voicing one line is cheap; do it rather than
keeping a slow read.

Leave 1.2-1.3s silence at the start (title card) and 2-2.6s at the end (end
card readable before the fade).

## Bleeps

`"mix": {"bleep": [{"line": "b01", "word": "<word>"}]}` replaces that word
(30ms before to 20ms after) with a 1 kHz tone. Show a censor bar on screen at
the same word. Scribe transcribed the result as `[beep]`: that is the check.

## Music

- Use one prompt-mode cue per mood with `force_instrumental`, not a
  composition plan: plan chunk `text` is sung as lyrics, and with empty text
  the section moods are followed loosely (flat energy across sections).
- Cut between cues on story beats rather than crossfading: a record-scratch
  SFX hides a hard stop, and a sad cue can fade in under the next line.
- Ask for 1-3s more than the section needs; cues often end early with
  silence (a 10s request had music for about 8s). `film.py music` prints
  energy per half second so you can see where a cue actually ends or builds.
- Two music requests at a time: the plan caps concurrent requests and a
  third returns 429 `concurrent_limit_exceeded`.
- Always end the prompt with "No vocals."

Prompts that worked for a comic documentary:

| Cue | Prompt core |
|---|---|
| intro / chaos | whimsical British nature-documentary comedy score, pizzicato strings, glockenspiel, playful flute, soft tabla; after 15 seconds a bouncy comic scramble with bassoon and hand claps, 120 bpm |
| triumph | triumphant festive fanfare, bright brass, dhol drums, soaring sitar, rising excitement, ending on a snare roll |
| deflated | sad comic deflation, slow lonely harmonium and mournful solo cello, sparse, gently funny, no drums |
| finale | hopeful whimsical finale, full ensemble reprise, building to a neat final button chord and stopping cleanly |

Match instruments to the subject (tabla and sitar suited a film about
going for a curry).

## Sound effects

One generation per effect, 0.5-3s, `prompt_influence` 0.6-0.8. A comedy
kit that covered a whole film: paper whoosh (two variants), cork pop, bubble
pop, rubber stamp thud, marker scribble, coin flick-spin-land, record
scratch, heavenly choir sting, sad trombone, notification chime, neon
flicker, small group cheer, romantic violin sting, owl hoot, tabla flourish,
woodland ambience (8s), calendar pages fluttering, rain (5s), spring boing,
snare roll, crunchy snack snap, sizzle, soft card thud, cymbal crash.

Place them in `mix.sfx` as `[name, time-ref, gain]`; gains 0.3-0.6, 0.8-1.0
for punchlines (stamp, scratch). Time refs: a number, `"c02"` (line start),
`"c02$"` (line end), `"c02:bail"` (word start), each with an optional
`+0.1`/`-0.2`. Anchor to words wherever the visual is anchored to a word.

## Mix

`film.py mix` ducks music by 55% under voice (25% for SFX), sums at 0.8
headroom, then loudness-normalises to -15 LUFS integrated, -1.5 dBTP. The
printed peak must stay under 1.0 before normalisation. Stem levels that read
well: voice about -18 dBFS RMS, ducked music about 10 dB under, SFX about
5 dB under.

## Checking audio with speech-to-text

Transcribe instead of listening, at three points:

1. Every voice line after `tts` (automatic): catches wrong words, spoken tags,
   mispronounced names (a transcript splitting an invented group name
   differently was acceptable; one reading a different word is not).
2. Every music cue: `film.py stt <cue.mp3>`. Anything other than a tag like
   `[upbeat music]` means vocals. This is how sung plan text was caught.
3. The final share MP4: `film.py stt <share.mp4> --find <punchline words>`.
   Word times must match the timeline's anchors (they matched to 0.01s), and
   bleeped words must be absent.
