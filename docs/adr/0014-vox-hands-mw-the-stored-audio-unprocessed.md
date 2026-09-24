# vox hands mw the stored audio unprocessed

`vox` transcribes each stored WAV as captured. Nothing trims or filters the
audio before `mw` reads it. The guard against lost speech is a detector that
runs after transcription: `_vox_report_blanked` measures each track and warns,
to stderr and `vox.log`, when `vox_track_blanked` finds audible audio behind an
empty transcript.

## Context

Parakeet has returned an empty transcript for a clip that ends in enough
digital zeros
([NVIDIA-NeMo/Speech#15757](https://github.com/NVIDIA-NeMo/Speech/issues/15757)).
voxtap's padding gives exactly that shape to a far side who speaks and then
goes quiet, so trimming the silence before transcription looks like the fix.

Measured against the pinned model (`parakeet-pro:nvidia_parakeet-v3_494MB`),
with padding verified as exact zeros (`astats` Max level 0.000000), the failure
does not reproduce. A 4 s utterance transcribes under 5, 12, 24, 60 and 120 s
of zeros, and still does attenuated to -40, -50 and -60 dB mean. So does the
2.6 s / -46 dB shape of the original report. `mw` is a self-updating GUI app
outside mise and nix, so an upstream fix is the likeliest account. "Fixed" and
"misdiagnosed" cannot be told apart, and the action is the same either way.

## Alternatives considered

- **Pre-process each track with ffmpeg `silenceremove`.** Lost because it
  destroys speech. A positive `stop_periods=1` stops output at the *first*
  silence run of `stop_duration` or longer, counted from the start; it does not
  trim only the end. On 2026-09-14 it cut a 2158 s system track to 7.91 s
  (`{"segments":[],"text":""}`, so `vox_session_kind` reported a 36-minute call
  as `solo`) and a 1158 s mic track to 88.97 s, keeping 4 of 43 segments. The
  gaps it cut on measure ±6 LSB: real near-silence from the far side, not
  padding. Any filter aimed at zeros also guards only that one cause.

## Consequences

- The detector catches an empty transcript over audible audio from any cause,
  a future model regression included.
- It does not catch a *partial* truncation. With no filter, vox has no
  mechanism that produces one.
- `vox-contract.bats` keeps a real-`mw` regression test for the zero-padded
  case. It is one-sided by construction. A failure there is the evidence that
  would justify pre-processing again.
