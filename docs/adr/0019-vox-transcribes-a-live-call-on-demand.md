# vox transcribes a live call on demand

`vox grab [5m]` transcribes the recording in progress when asked, and nothing
transcribes in between. [`snapshot.py`](../../.config/vox/snapshot.py) copies
each still-growing track into a complete WAV. The usual `fluidaudiocli`,
`segments.py` and `merge.py` run over the copies in a temp directory, and
`prefix + Alt+y` puts the result on the clipboard.

## Context

The need is to hand the call so far to an agent mid-meeting. That covers
actions that should happen now rather than after the recording, and questions
about what was just said. Actions, decisions and catch-up are read from
`transcript.md` after the call. Calls are on headphones, so the mic track
carries only the user.

Measured on this machine: `fluidaudiocli` transcribes 30 s of one track in
about 0.5 s, model load included, and a 10 s slice costs about 0.12 s of CPU
and 80 MB. A 27-minute track takes 6 s. So transcribing on demand returns text
up to the key press within seconds. A background loop's text lags behind by
the loop's interval.

voxtap writes through `ExtAudioFileWriteAsync`, which leaves the header's data
size at 0 until the file is disposed on stop. The PCM is on disk and growing,
from byte 4096 behind an FLLR padding chunk. Reading a live track therefore
means trusting the file length, not the header.

## Alternatives considered

- **A watcher tailing the growing WAVs into `live.md`.** Stdlib Python, about
  every 8 s, with no voxtap change. It lost because its committed text trails
  speech by 10-15 s, which misses exactly the thing just said. On-demand
  transcription is both fresher and cheaper. It remains the path to an
  always-visible view and reuses `snapshot.py`.
- **voxtap streaming PCM to a FluidAudio streaming recogniser.** A Unix socket
  from a ring in the IO proc feeding `SlidingWindowAsrManager`. It lost because
  it needs the SwiftPM build and the realtime-path code that
  [ADR 0018](0018-vox-transcribes-with-the-fluidaudio-cli.md) kept out of
  voxtap, for a latency the need does not ask for.
- **Apple SpeechAnalyzer in its own binary with its own tap.** It lost because
  it duplicates [ADR 0012](0012-vox-captures-both-tracks-in-one-voxtap-aggregate.md)'s
  single aggregate device, and three things it rests on were untested: two taps
  at once, its accuracy against Parakeet, and Neural Engine contention.
- **voxtap also writing closed 10 s segment files.** It lost because it changes
  the capture process to serve a read-only feature.
- **Nothing, waiting for `vox stop`.** It lost because stopping mid-call splits
  the recording, and the point is to act before the call ends.

## Consequences

- A grab is never diarised: speaker labels from a partial run would contradict
  the final transcript's, so the far side is one `Them`.
- Words cut at a `--last` window's start can be garbled. A whole-call grab has
  no such edge.
- A grab never writes into the recording's directory, so stop, the pill and
  compaction cannot see one. Each grab gets a fresh `mktemp -d`, left for the
  system's temp cleanup.
- Switch to the watcher if waiting for a whole-call grab gets in the way, or an
  always-visible view is wanted. Switch to SpeechAnalyzer only if sub-second
  text is needed, after a spike shows two taps running together without
  glitches in voxtap's log.
