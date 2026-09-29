# vox transcribes with the FluidAudio CLI

`vox` transcribes each track with `fluidaudiocli transcribe --word-timestamps`
and diarises the system track (and an imported file) with `fluidaudiocli
process --mode offline`. The CLI is a mise tool, `spm:FluidInference/FluidAudio`,
built from its release tag. [`segments.py`](../../.config/vox/segments.py) turns
the two outputs into the per-track segment JSON `merge.py` and `vox-lib.sh`
already read. The raw outputs stay beside it as `<track>.asr.json` and
`<track>.diar.json`.

## Context

`mw`, the MacWhisper CLI, is a client of the MacWhisper GUI app over a local
socket. It launches the app when the app is closed
([docs](https://docs.macwhisper.com/article/57-macwhisper-command-line-tool)),
so every `vox stop` brought the app up. The app's dictation is bound to
`rightOption`, the key the foot pedal emits ([ADR 0013](0013-foot-pedal-meaning-lives-in-firmware.md)),
and a running MacWhisper interfered with Hex dictation on the same machine.

FluidAudio runs the same Parakeet v3 model on Core ML with no app. Measured on
a 27-minute system track (2026-09-28-135931-boaz): 6 s to transcribe, 5 s to
diarise, and 24 s for `vox transcribe` over both tracks. It found 2355 words
against `mw`'s 2451; most of the gap is `mw` splitting contractions ("it" +
"s").

## Alternatives considered

- **Keep `mw` and unbind MacWhisper's dictation key.** Lost because `mw` still
  needs the GUI app for every transcription, and for model downloads. The app
  also updates itself, outside mise and nix.
- **Link FluidAudio into `voxtap` as a Swift library.** Lost because
  `voxtap.nix` compiles one `main.swift` with the system `swiftc` in seconds.
  The library needs a SwiftPM build that fetches dependencies inside the
  derivation and takes minutes. It also puts ML code in the capture process, so
  a model fault could lose a recording.
- **parakeet-mlx plus pyannote community-1, in Python.** Lost because both run
  on the GPU (MLX and PyTorch MPS), which Hex 2.x also uses for its own
  Parakeet. pyannote also needs a Hugging Face token, and a dependency tree
  would end `vox/`'s stdlib-only rule.
- **Store FluidAudio's own JSON and teach every reader it.** Lost because
  `merge.py`, `vox_has_segments` and `vox_session_kind` would each need a
  second parser, since older recordings keep `mw`'s JSON. Converting once in
  `segments.py` keeps one schema.

## Consequences

- `fluidaudiocli transcribe` exits 0 when it cannot read the audio, and writes
  no file. vox treats the missing file as the failure, and `vox-contract.bats`
  pins the behaviour.
- Speaker labels come from one diarisation run. `S1` in one run need not be
  `S1` in the next.
- Numbers are not normalised: FluidAudio writes "i os twenty seven" where `mw`
  wrote "iOS 27".
- A release build logs below warning level to the unified log only, so vox
  shows no per-track progress.
- The spm backend builds from source (about 2.5 minutes). `mise.lock` records
  the tag and no checksum. The tool is macOS-only.
