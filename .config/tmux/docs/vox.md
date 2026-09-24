# vox (recording + transcription, custom subsystem)

Local audio capture and on-device transcription, in the same
one-lib-many-surfaces shape as the caffeine toggle. One detached
[`voxtap record`](../../nix/voxtap/main.swift) captures the mic and the system's own
output (a Core Audio process tap) through one aggregate device to two mono
16 kHz WAVs; `vox stop` finalises them, transcribes each with the MacWhisper CLI
(`mw`) and merges them into one timestamped `transcript.md`. General-purpose by design - meetings,
monologues, dictation - with no consumer baked in: integration is
`cat "$(vox last)/transcript.md" | claude -p …`.

**System audio needs no setup at all** - no loopback driver, no Multi-Output
Device, no default-output switch, headphones optional. `vox` *refuses to start*
when the tap or the mic is unavailable rather than half-capturing a meeting;
`VOX_MIC_ONLY=1` is the named escape hatch (the same helper, the tap left out).
Why a tap and why no fallback:
[`docs/adr/0003`](../../../docs/adr/0003-vox-system-audio-capture.md); why one
process and one clock, and what was measured before building it:
[`docs/adr/0012`](../../../docs/adr/0012-vox-captures-both-tracks-in-one-voxtap-aggregate.md).

**The store convention is the decision everything else depends on.** One directory per
recording under `${VOX_STORE:-~/Recordings/vox}`:

```text
2026-07-28-140312-triver-kickoff/
    mic.wav  sys.wav      you / them (sys silent => it was a monologue)
    mic.json sys.json     per-track mw output, so a re-merge never re-transcribes
    transcript.md         merged, name-fixed - the artefact everything consumes
    vox.log               voxtap + mw stderr (mw reports progress there)
    transcribing.pid      only while mw runs: "pid start_epoch"
```

The directory name **is** the title - no metadata file holding a duplicate that
can drift - so renaming is `mv`, and Finder, hand and the picker are one
operation. Only the timestamp prefix is ever parsed, never the slug. Colons are
hostile in filenames, hence `YYYY-MM-DD-HHMMSS` rather than strict ISO 8601.

**`solo` vs `2-way` is derived, never stored.** `vox_session_kind` reads whether
`sys.json` carries any segments: if the system track transcribed to nothing,
nobody else spoke. Already on disk, free to read, and self-healing after a
re-transcription - which is why there is still no metadata file. Silence is
therefore a *label*, not an error, and that is what removes any need to declare a
mode at start.

Change as a set:

- [`scripts/vox-lib.sh`](../scripts/vox-lib.sh) - **canonical** state
  (`vox_state`: `RECORDING > TRANSCRIBING > EMPTY > READY > IDLE`, in that
  precedence, the same worst-first shape as the agent dots' `rank`) and the
  colour/glyph/token language (`vox_state_colour` subtext0 `a6adc8`, blue
  `89b4fa` for READY, red `f38ba8` for EMPTY, `vox_state_glyph` `~` `≈` `!` `✓`,
  `vox_token` elapsed via the
  shared `human_age`, or the unread/empty count). Every state is derived from a file
  whose staleness cannot lie, so none of them needs a reaper:
  **`<dir>/transcribing.pid`** holds `pid start_epoch` for the transcription
  `vox stop` or `vox transcribe` is spending minutes on, inside the recording it
  is working on - written and removed by those commands themselves, so the pill
  says TRANSCRIBING whether the stop was typed in a pane or detached by the
  toggle, and a crashed `mw` reads as finished by pid liveness alone. Per
  recording, not one global file, because two transcriptions overlap whenever a
  stop lands while an earlier one is still running: a shared file let each
  overwrite the other's record and the first to finish delete it for both, so
  the pill dropped `≈` early. `vox_job_dirs` scans the store for live markers
  (newest first); the token is the longest-running job's elapsed time, or the
  count when more than one is running.
  **`${VOX_SEENFILE:-~/.cache/tmux-vox.seen}`** is a marker whose *mtime* is the
  last time you looked: READY is "a non-empty `transcript.md` is newer than
  this", which covers any number of finished recordings without tracking one of
  them, and makes touching the marker the only write. Cleared by opening the
  picker and by starting a new capture. `-size +0` in the count matters:
  a transcript with nothing in it is not something to go and read. It is instead
  counted by **`vox_empty_count`**, that count's mirror (`-size 0c`, same
  no-marker branch), so every finished transcript lands in exactly one of the two
  and the one marker clears both. EMPTY outranks READY: a recording that produced
  nothing is the one that needs you, and it masks an unread good one only until
  the picker is opened. **Statefile contract**:
  `${VOX_STATEFILE:-$HOME/.cache/tmux-vox.state}` holds one line
  `pid start_epoch dir` - the capture process, whose liveness means RECORDING
  (`read` puts the remainder in the last field, so a directory with spaces
  survives; a comma-separated pid list is still read, leader first). It also
  owns the **pure text parser** the reclaim path needs - `vox_mean_volume` /
  `vox_classify_track` (over `volumedetect` output) - so the monologue/meeting
  call is testable with fixtures and no audio hardware. Sourced, never run.
- [`../zsh/functions/macos/vox`](../../zsh/functions/macos/vox) - the dual-mode
  command (`vox` / `--name` / `stop` / `cancel` / `status` / `ls` / `last` /
  `<file>` / `transcribe` / `rename` / `compact` / `prune`). Every subcommand
  prints **bare paths to stdout, one per line**, with progress and diagnostics on
  stderr, so it composes without glue. **Exit 0 means the transcript has
  content**: `stop`, `transcribe` and `<file>` print the recording's path either way - the audio is intact, so there
  is somewhere to look - but return non-zero, with one line naming what was not
  recognised, how long the audio was and where the log is. `mw` exits 0 whatever
  it heard, so nothing upstream of this check can tell "no speech" from "mw fell
  over", and one message covers both. `prune --empty` selects by *content* instead of age -
  the silent track of a monologue, keeping the one that carries the recording -
  and is the production caller of the lib's loudness parsers. It measures only
  its candidates, at the moment you ask, and refuses a recording whose every
  track is silent: that is a delete-the-recording decision, not a reclaim one.
- [`../nix/voxtap/main.swift`](../../nix/voxtap/main.swift) - the capture engine,
  built by [`../nix/modules/voxtap.nix`](../../nix/modules/voxtap.nix) with the
  system `swiftc` (desktop-only, like `biokc`/`imagepaste`). `voxtap record
  <dir> --mic <name> [--no-sys]` puts the microphone (named by a case-insensitive
  substring of its Core Audio name, or its exact UID) and a process tap in one
  aggregate device with the mic as clock master, and writes `mic.wav` and
  `sys.wav` from one IO proc, so the tracks are aligned by construction; SIGINT
  or SIGTERM finalises both. It refuses with one line and no files when the tap
  or the mic is unavailable, which is what lets `vox` refuse to start. A mic
  that disappears is rebuilt through the same selection rule ten times, then
  the files are finalised and it exits 1. `--probe N` runs the same aggregate
  and reports frames, elapsed and levels instead of writing. **First run after
  `drs`**: `voxtap --probe 1` in the foreground takes the microphone TCC prompt
  (a detached first start would sit behind it until the 10 s wait expired; the
  grant is to the terminal and persists across rebuilds).
- [`../vox/merge.py`](../../vox/merge.py) - a real Unix filter: two `mw` JSON files
  in, interleaved `[hh:mm:ss] Name: text` markdown out, no side effects.
  Stdlib-only so the directory stays eligible for the `py-typecheck-vox` pyrefly
  gate. Applies [`../vox/vocabulary.tsv`](../../vox/vocabulary.tsv) (`wrong<TAB>right`,
  whole-word and case-insensitive) because `mw transcribe` has no
  `--vocabulary`/`--prompt` flag and no replacement dictionary in its prefs.
- [`scripts/vox-toggle.sh`](../scripts/vox-toggle.sh) - `prefix + Alt+v`, the
  key the subsystem is actually used through: idle starts, recording stops. Two
  orderings are the design. **The title prompt appears at once, with the capture
  starting behind it**, and how the prompt is dismissed decides the recording's
  fate: Enter keeps it (a title is applied with `vox rename`, an empty answer
  leaves the timestamp), Esc discards it with `vox cancel`. Starting costs a
  second or more of device setup with nothing to look at, so asking first is
  what makes the key feel instant; the answer is acted on only once the start
  has returned, so a start that fails is reported and neither renames nor
  cancels. With no client to ask the recording is kept and said so. Every
  outcome ends in a `display-message`. **Stopping detaches**: `vox stop` stays
  synchronous by contract, and a key press has nowhere to put minutes of
  transcription, so the pill carries the wait and a `display-message` plus
  `ring_bell` reports the end. It reports the **exit code**, not merely whether
  the command ran: a transcript with nothing in it says "no speech transcribed"
  and names the log, and the bell rings either way - a recording that produced
  nothing needs you more than one that worked. Pressed while TRANSCRIBING it
  starts a new capture - transcription is per-directory and detached, so the two
  never contend. **The title prompt is one literal question** (`command-prompt
  -l`, see [the findings](#findings-that-break-things-if-ignored)) and the script owns it: `ask_title` raises it
  and reads the answer back through a tmux user option, and `vox-toggle.sh
  prompt DIR [CLIENT]` is the single door for the pill menu's Name…, where Esc
  means "no rename" - that prompt did not start the capture, so it is not its to
  end. **The key runs detached** (`run-shell -b`, in [`tmux.conf`](../tmux.conf)):
  the script lives for as long as the prompt is open, and a foreground job
  queues every key pressed while it lives.
- [`scripts/vox-menu.sh`](../scripts/vox-menu.sh) - the menu behind a click on
  the pill (`#[range=user|vox]`, dispatched from the `MouseDown1Status` chain in
  [`tmux.conf`](../tmux.conf) beside `agents` and `mem`). **Its rows match the
  state**: recording offers Stop / Name… / Discard / Recordings, everything else
  offers Recordings alone. A Stop row with nothing to stop is exactly the drift
  the one-lib rule exists to prevent, which is why the menu is a script reading
  `vox_state` rather than a literal in the config. Discard is `vox cancel` and
  the only `confirm-before` row: it throws audio away, while stopping only
  spends time. **Name… delegates to `vox-toggle.sh prompt`** rather than
  re-spelling a `command-prompt` inside four levels of escaping, and passes the
  clicking client through so the question lands where it was asked for; the
  pill-click row is `run-shell -b` because `display-menu` blocks its caller the
  same way `command-prompt` does.
- [`scripts/vox-popup.sh`](../scripts/vox-popup.sh) - `prefix + Alt+Shift+V` fzf
  library over `vox ls`, previewing each transcript and carrying the derived
  `solo`/`2-way` column - or `empty`, for a recording that transcribed to
  nothing, which `solo` would make indistinguishable from a real monologue. The
  preview is four-way for the same reason: a transcript that exists and is empty
  is *finished*, so "No transcript yet" over it reads as pending forever, and one
  whose marker is live says "Transcribing…". Enter
  opens an **action list** - every action with its shortcut, copy first so
  enter-enter copies, esc back to the recordings - and the shortcuts work from
  either stage: copy (tmux buffer plus OSC52), `ctrl-y` pastes the path into the
  calling pane, `ctrl-e` edits, `ctrl-r` renames, `ctrl-o` reveals in Finder,
  `ctrl-p` plays (both tracks mixed when there are two, via a temp file because
  `afplay` cannot read a pipe), `ctrl-t` retranscribes in place (unconfirmed: the
  WAVs stay), `ctrl-d` deletes and `ctrl-x` reclaims audio, the last two
  confirmed; `ctrl-t`, `ctrl-d` and `ctrl-x` act over the whole `tab` selection.
  Retranscribing and reclaiming shell out to **`vox transcribe <path>`** and
  **`vox prune <path>...`** rather than doing it here - which files count as
  audio, what survives and how a track is transcribed each have one owner, and
  that is why the CLI grew explicit paths. Opening it is what marks everything
  looked-at, so it is the thing that clears the READY pill. Actions run
  **after** fzf exits (`--expect`), not inside `--bind execute()`, so each owns
  the popup's real tty; the action list is a second `--expect` stage for the
  same reason - it only decides the key, the action still runs outside fzf.
- [`scripts/status-right.sh`](../scripts/status-right.sh) - `vox_segment()`, a
  **self-hiding** pill (width ≥ 80) following one capture from start to read:
  IDLE prints nothing, then `~ 12m` recording, `≈ 40s` transcribing, `✓ 2`
  waiting, `! 1` red for a recording that transcribed to nothing. It reads the
  lib, so the EMPTY pill needed no change here.
  Deliberately the *opposite* treatment to caffeine's bright peach
  alarm - muted subtext0 on the surface1 data-pill shade - because it is visible
  during screen shares and should read as ambient chrome. READY is the one
  exception, in the agent dots' unread blue, and it can only appear once the
  capture has stopped. Elapsed uses `human_age`, not mm:ss, which would tick in
  15 s jumps at this `status-interval` and read as broken.

## Findings that break things if ignored

- **`command-prompt` splits `-p` and `-I` on commas**, into a *sequence* of
  prompts with one answer each (`%%`, `%1`, `%2`, …). So any prompt holding
  **text** - a title, a window label, a path - needs **`-l`** (tmux 3.6+), which
  takes both flags literally. Without it the status line shows the truncated
  first half, and Enter opens a second prompt that swallows every keystroke: the
  "tmux is frozen" symptom, from a wording change nobody thought was a flag
  change. The splitting is deliberate in
  [`scripts/claude-branch-menu.sh`](../scripts/claude-branch-menu.sh) and
  [`scripts/codex-branch-menu.sh`](../scripts/codex-branch-menu.sh), which ask for
  several values at once - hence a rule, not a blanket `-l`.
- **A foreground `run-shell` queues the client's keys.** Keys pressed while the
  job is alive are delivered only once it exits (measured on 3.7b), and a job
  that raises a `command-prompt` or `display-menu` from the CLI lives until that
  prompt or menu closes. A binding whose script prompts therefore needs
  `run-shell -b`, unless something genuinely needs the exit status.
- **`run-shell -b` prints `'<cmd>' returned N` for a non-zero exit**, after
  and over any `display-message` the script made, so the script's own reason
  is the message that gets replaced. A binding script reports with
  `display-message` and exits 0 on every path.
- **`command-prompt` without `-b` blocks the CLI until the prompt is dismissed,
  and its template has run by the time the CLI returns** (measured on 3.7c:
  five of five). `-b` makes the CLI return at once - the man page's "the
  invoking client does not exit until it is dismissed" reads as the opposite,
  and is not what happens - so a script that needs the answer must not pass it.
  The CLI exits 0 for Esc and Enter alike; only the template's side effect
  tells them apart.
- **A prompt's answer must never be spliced into a shell command line.** `%%`
  and `%%%` substitute the typed text into the template, tmux parses the result,
  and `run-shell` hands it to `sh -c`: measured, a backtick in a title ran `id`
  and `$HOME` expanded, and every shell-quoted form loses a title holding a
  single quote - the callback never runs, which under Esc-discards reads as Esc
  and deletes the recording. `set-option -g @name "x%%%"` is parsed by tmux
  alone and survived every title tried (quotes of both kinds, `$`, backticks,
  `;`, `#`, `\`, `%%`, UTF-8); the script reads the option back and unsets it.
  The `x` prefix is what makes an empty answer distinguishable from no answer.
  Note that `source-file` *does* expand `$VAR` inside such a string where the
  prompt's own path does not, so a test must drive the real prompt rather than
  replay its template.
- **Stop is SIGINT, and the wait for the pid is the wait for the files.**
  voxtap answers INT (and TERM) by flushing both tracks and writing their RIFF
  sizes before it exits; transcribing before that would read a WAV that claims
  to be empty.
- **A background job from a non-interactive shell inherits SIGINT as `SIG_IGN`**
  (POSIX), and a shell cannot then `trap` it. voxtap's dispatch signal source
  fires regardless of the inherited disposition - so `vox stop` works - but a
  `trap … INT` shell *fake* cannot model that and would appear to prove the
  opposite. The voxtap stub in [`../zsh/tests/vox.bats`](../../zsh/tests/vox.bats)
  is therefore Python.
- **A `DispatchSourceSignal` must be held for the life of the process.** Swift
  releases a local after its *last use*, not at scope end, and a released source
  is cancelled: held in a block-local `let`, the SIGINT source was gone before
  the run loop started and the signal was silently ignored. voxtap keeps its
  sources in a global.
- **The tap buffer through silence is full-size zeros when the tap shares an
  aggregate with a hardware clock** - 2048 bytes per 512-frame cycle, not
  `mDataByteSize 0` and not an absent callback (measured; the tap alone in its
  aggregate delivers nothing through silence, which is why the old stream mode
  needed a padding timer). The mic and the tap deliver the same frame count
  every cycle, at 48 kHz and with a 44.1 kHz mic as master alike; the alignment
  invariant is regression-tested in `vox-contract.bats`.
- **A global process tap follows a default-output switch on its own.** Measured
  with the output switched to the built-in speakers mid-capture and back: the
  tone resumed in the tap both times. Nothing rebuilds on that event.
- **Nothing pre-processes the audio, and the guard against losing speech is a
  detector rather than a filter.** `mw` reads each stored WAV directly.
  vox used to hand it a `silenceremove`d copy, because Parakeet once returned an
  EMPTY transcript for a clip ending in enough digital zeros
  ([NVIDIA-NeMo/Speech#15757](https://github.com/NVIDIA-NeMo/Speech/issues/15757)) -
  which is exactly the shape voxtap's padding gives a far side who speaks and then
  goes quiet. Two things ended that arrangement:
  - **The premise no longer holds.** Re-measured against the pinned model
    (`parakeet-pro:nvidia_parakeet-v3_494MB`) with padding verified as exact zeros
    (`astats` Max level 0.000000): a 4 s utterance transcribes under 5, 12, 24, 60
    and 120 s of zeros, and still does attenuated to -40, -50 and -60 dB mean; so
    does the exact 2.6 s / -46 dB shape the original measurement used. `mw` is a
    self-updating GUI app outside mise and nix, so the likeliest account is an
    upstream fix, but "fixed" and "misdiagnosed" are not discriminable now and the
    action is the same either way.
  - **The filter was destroying data.** A POSITIVE `stop_periods=1` stops output
    at the FIRST silence run of `stop_duration` or longer, counted from the start -
    it does not trim the end alone, whatever the old comment here said. Two
    recordings on 2026-09-14 lost most of their speech to it: a 2158 s system track
    reached `mw` as 7.91 s (`{"segments":[],"text":""}`, and `vox_session_kind` then
    reported the 36-minute call as `solo`), and a 1158 s mic track as 88.97 s,
    keeping 4 of 43 segments. The internal gaps it cut on measure ±6 LSB, so they
    were the far side's real near-silence, not padding.

  In its place, `_vox_report_blanked` measures each stored track after
  transcription and warns - to stderr and `vox.log`, naming the track and its mean
  level - when `vox_track_blanked` finds audible audio behind an empty transcript.
  It covers the same loss from any cause, including a future model regression,
  which a filter aimed at zeros cannot. The zero-padded case still has a real-`mw`
  regression guard in `vox-contract.bats`; it is one-sided by construction, and
  failing it is what would justify re-adding pre-processing.
  What it deliberately does not catch is a PARTIAL truncation - deleting the
  filter removes that failure rather than detecting it.
- **The mic track is channel 0 of the mic's first buffer**, never a downmix: a
  multichannel input would otherwise get a surround matrix (LFE and height
  coefficients) instead of the channel apps actually write. The tap is mono at
  source.
- **The mic is resolved by name at start**, never by a recorded index: device
  ids and orderings change when one appears or disappears (connecting AirPods
  is enough). HAL names equal avfoundation's, so `VOX_MIC_DEVICE=Microphone`
  selects the same device it always did. System audio needs no lookup at all.
- **`local path=…` in zsh empties `$PATH`.** zsh ties the `path` array to `PATH`,
  so a scalar local of that name kills external command lookup for the whole
  function. `_vox_rename` uses `rec`/`full` for exactly this reason.
- **`:a`, not `:A`, when echoing a path back.** `:A` resolves symlinks, so the
  printed path jumps to the physical one (`/var` → `/private/var` on macOS) and
  no longer matches the store path the caller passed in.
- **The model is pinned per invocation** (`mw transcribe --model …`), never via
  `mw models select`, which mutates the GUI app's own state.
- **`mw` emits a top-level `"text"` key even when it transcribed nothing.** So
  `vox_session_kind` tests positively for a segment object (`"segments":[{`
  after stripping whitespace, because mw pretty-prints); looking for the word
  `"text"` called every silent system track `2-way`. Hand-written fixtures could
  not catch this, which is why `vox-contract.bats` now drives real `mw` over
  real silence.
- **A quiet room is nowhere near digital silence.** Measured here: a system
  track that captured nothing reads **-91 dB**, a microphone in a quiet room
  **-55 dB**. `VOX_SILENCE_DB` therefore sits at -70, between them - above the
  mic's floor and `prune --empty` finds a monologue's *mic* track silent too,
  and skips the recording as having captured nothing.

Tests: [`../zsh/tests/vox-lib.bats`](../../zsh/tests/vox-lib.bats) (pure lib: the
four states and their precedence via real statefiles and marker mtimes, elapsed,
colour/glyph/token, and the loudness parser against captured fixtures),
[`../zsh/tests/vox.bats`](../../zsh/tests/vox.bats) (the command:
ls/last/status/rename/cancel/compact/prune, plus the voxtap argv and SIGINT stop
via PATH-shadow fakes - the voxtap fake is Python, for the reasons in the
[findings](#findings-that-break-things-if-ignored)),
[`../zsh/tests/vox-toggle.bats`](../../zsh/tests/vox-toggle.bats) (the binding, on a
bare server with a real pty client answering the real prompt: prompt-before-start
order, Esc/Enter/title outcomes, the no-client path and the detached stop),
[`../zsh/tests/vox-menu.bats`](../../zsh/tests/vox-menu.bats) (the pill menu's rows
per state), [`../zsh/tests/vox-popup.bats`](../../zsh/tests/vox-popup.bats) (the
library's actions, driven through a stubbed fzf), [`../zsh/tests/vox-contract.bats`](../../zsh/tests/vox-contract.bats)
(integration-tagged: drives the **real** `mw` against the JSON schema `merge.py`
parses - the one contract here that is not ours to keep - and the **real**
`voxtap` against the alignment invariant) and
[`../vox/test_merge.py`](../../vox/test_merge.py) (the filter). Keep the pill legend
in [`help.md`](../help.md) in sync with the lib.
