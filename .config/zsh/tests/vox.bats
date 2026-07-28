#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it.
VOX="$HOME/.config/zsh/functions/macos/vox"
VOX_LIB_REAL="$HOME/.config/tmux/scripts/vox-lib.sh"
MERGE_REAL="$HOME/.config/vox/merge.py"
FIXTURES="$BATS_TEST_DIRNAME/fixtures"

setup() {
  setup_test_home
  export VOX_LIB="$VOX_LIB_REAL"
  export VOX_MERGE="$MERGE_REAL"
  export VOX_STORE="$HOME/Recordings/vox"
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_VOCAB="$HOME/vocab.tsv"
  mkdir -p "$HOME/.cache" "$VOX_STORE"
  # The output-device check shells out to pgrep and (if a meeting app is up)
  # system_profiler. Stub pgrep to "nothing running" so tests neither depend on
  # what the developer happens to have open nor pay for a hardware probe.
  write_stub pgrep <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
}

# --separate-stderr: "bare paths to stdout, diagnostics to stderr" is part of
# the contract under test, so $output must not carry the progress lines.
vox() {
  run --separate-stderr zsh --no-rcs "$VOX" "$@"
}

# A recording directory in the store, named the way vox names them.
recording() {
  mkdir -p "$VOX_STORE/$1"
  printf '%s\n' "[00:00:00] Me: $1" >"$VOX_STORE/$1/transcript.md"
}

# ffmpeg stub: answers -list_devices from the captured fixture, otherwise
# behaves like a capture — touch the output WAVs, then stay alive until it is
# signalled, recording WHICH signal it got. That is what lets a test assert the
# stop path uses SIGINT.
#
# Written in Python, not shell, and that is load-bearing. A background job
# started by a NON-interactive shell inherits SIGINT (and SIGQUIT) as SIG_IGN —
# POSIX requires it — and a shell cannot then trap them, so a `trap ... INT`
# fake would appear to prove vox stop is broken. Real ffmpeg calls
# signal(SIGINT, ...) unconditionally, which overrides the inherited ignore
# (verified: a backgrounded ffmpeg exits on INT and leaves a valid WAV header).
# Python's signal.signal does the same, so this fake models the real binary.
stub_ffmpeg() {
  write_stub ffmpeg <<'EOF'
#!/usr/bin/env python3
import os
import signal
import sys
import time

argv = sys.argv[1:]
log = os.environ["TEST_LOG"]


def note(line):
    with open(log, "a") as fh:
        fh.write(line + "\n")


note("ffmpeg " + " ".join(argv))

if "-list_devices" in argv:
    with open(os.environ["VOX_DEVICES_FIXTURE"]) as fh:
        sys.stderr.write(fh.read())
    sys.exit(1)

for arg in argv:
    if arg.endswith(".wav"):
        with open(arg, "w") as fh:
            fh.write("RIFF")


def handler(sig, _frame):
    name = "INT" if sig == signal.SIGINT else "TERM"
    note("ffmpeg-signal " + name)
    sys.exit(0 if sig == signal.SIGINT else 1)


signal.signal(signal.SIGINT, handler)
signal.signal(signal.SIGTERM, handler)
# Self-limiting: a test that forgets to signal this must not leave a capture
# running past the suite.
time.sleep(60)
EOF
  export VOX_DEVICES_FIXTURE="$FIXTURES/vox-avfoundation-devices.txt"
}

# Reap any capture a test left running, so a failure cannot leak a process.
teardown() {
  if [ -f "${VOX_STATEFILE:-}" ]; then
    kill "$(awk 'NR == 1 { print $1 }' "$VOX_STATEFILE")" 2>/dev/null || true
  fi
}

# mw stub: logs its argv and emits the JSON schema the real CLI emits.
stub_mw() {
  write_stub mw <<'EOF'
#!/usr/bin/env bash
printf 'mw %s\n' "$*" >>"$TEST_LOG"
case "$*" in
*mic.wav*)
  printf '{"segments":[{"id":0,"start":0,"end":1000,"text":"hello there"}]}\n'
  ;;
*)
  # The system track carries a "speaker" key; the mic track does not, because
  # it is transcribed with --no-speakers.
  printf '{"segments":[{"id":0,"start":2000,"end":3000,"text":"yes hello","speaker":"Speaker 1"}]}\n'
  ;;
esac
EOF
}

require_macos() {
  [[ "$OSTYPE" == darwin* ]] || skip "capture needs macOS (avfoundation)"
}

# Like vox(), but answering the confirmation prompt from stdin.
vox_answer() {
  local answer=$1
  shift
  run --separate-stderr zsh --no-rcs "$VOX" "$@" <<<"$answer"
}

# A recording carrying audio, timestamped N days ago.
aged_recording() {
  local days=$1 stamp
  stamp=$(date -v "-${days}d" '+%Y-%m-%d-%H%M%S' 2>/dev/null ||
    date -d "-${days} days" '+%Y-%m-%d-%H%M%S')
  mkdir -p "$VOX_STORE/$stamp"
  printf 'RIFFplaceholder' >"$VOX_STORE/$stamp/mic.wav"
  printf '{"segments":[]}' >"$VOX_STORE/$stamp/mic.json"
  printf '[00:00:00] Me: hello\n' >"$VOX_STORE/$stamp/transcript.md"
  printf '%s\n' "$VOX_STORE/$stamp"
}

# --- ls / last: bare paths, one per line ------------------------------------

@test "ls prints bare paths, newest first" {
  recording 2026-07-26-090000-standup
  recording 2026-07-28-140312-triver-kickoff
  recording 2026-07-27-113000

  vox ls

  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "$VOX_STORE/2026-07-28-140312-triver-kickoff" ]
  [ "${lines[1]}" = "$VOX_STORE/2026-07-27-113000" ]
  [ "${lines[2]}" = "$VOX_STORE/2026-07-26-090000-standup" ]
}

@test "ls is silent and succeeds when there are no recordings" {
  vox ls

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "last prints the newest recording" {
  recording 2026-07-26-090000-standup
  recording 2026-07-28-140312-triver-kickoff

  vox last

  [ "$output" = "$VOX_STORE/2026-07-28-140312-triver-kickoff" ]
}

@test "last fails when there is nothing to print" {
  vox last

  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# --- status -----------------------------------------------------------------

@test "status is IDLE with no live capture" {
  vox status

  [ "$output" = "IDLE" ]
}

@test "status reports RECORDING with elapsed and the directory" {
  sleep 100 &
  pid=$!
  printf '%s %s %s\n' "$pid" "$(($(date +%s) - 120))" "$VOX_STORE/2026-07-28-140312" >"$VOX_STATEFILE"

  vox status
  kill "$pid" 2>/dev/null || true

  [ "$output" = "RECORDING 2m $VOX_STORE/2026-07-28-140312" ]
}

# --- rename: the timestamp prefix is the only parsed part -------------------

@test "rename preserves the timestamp prefix" {
  recording 2026-07-28-140312

  vox rename "$VOX_STORE/2026-07-28-140312" "Triver Kickoff"

  [ "$status" -eq 0 ]
  [ "$output" = "$VOX_STORE/2026-07-28-140312-triver-kickoff" ]
  [ -f "$VOX_STORE/2026-07-28-140312-triver-kickoff/transcript.md" ]
  [ ! -d "$VOX_STORE/2026-07-28-140312" ]
}

@test "rename replaces an existing slug rather than appending to it" {
  recording 2026-07-28-140312-old-name

  vox rename "$VOX_STORE/2026-07-28-140312-old-name" "new name"

  [ "$output" = "$VOX_STORE/2026-07-28-140312-new-name" ]
}

@test "rename sanitises a slug into lowercase single-dashed words" {
  recording 2026-07-28-140312

  vox rename "$VOX_STORE/2026-07-28-140312" "  Ascendx // Q3 Review!  "

  [ "$output" = "$VOX_STORE/2026-07-28-140312-ascendx-q3-review" ]
}

@test "rename with an empty slug strips back to the bare timestamp" {
  recording 2026-07-28-140312-old-name

  vox rename "$VOX_STORE/2026-07-28-140312-old-name" ""

  [ "$output" = "$VOX_STORE/2026-07-28-140312" ]
}

@test "rename refuses a directory with no timestamp prefix" {
  mkdir -p "$VOX_STORE/not-a-recording"

  vox rename "$VOX_STORE/not-a-recording" whatever

  [ "$status" -ne 0 ]
  [ -d "$VOX_STORE/not-a-recording" ]
}

@test "rename refuses to clobber an existing recording" {
  recording 2026-07-28-140312
  recording 2026-07-28-140312-taken

  vox rename "$VOX_STORE/2026-07-28-140312" taken

  [ "$status" -ne 0 ]
  [ -d "$VOX_STORE/2026-07-28-140312" ]
}

@test "rename fails on a path that does not exist" {
  vox rename "$VOX_STORE/2026-07-28-140312" anything

  [ "$status" -ne 0 ]
}

# --- unknown arguments ------------------------------------------------------

@test "an unknown argument that is not a file is an error, not a start" {
  vox definitely-not-a-file

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
}

@test "help lists the subcommands without touching state" {
  vox --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"vox stop"* ]]
  [ ! -f "$VOX_STATEFILE" ]
}

# --- capture: the ffmpeg invocation -----------------------------------------
#
# PATH-shadow fakes rather than function mocks, so real command lookup and
# argument passing are exercised and the logged argv is the assertion target.

@test "start launches one ffmpeg carrying both inputs and records the state" {
  require_macos
  stub_ffmpeg

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  pid=$(awk '{ print $1 }' "$VOX_STATEFILE")
  kill "$pid" 2>/dev/null || true

  [ "$status" -eq 0 ]
  [ "$(grep -c '^ffmpeg ' "$TEST_LOG")" -eq 2 ] # the listing probe, then the capture
  [[ "$argv" == *"-f avfoundation -i :0"* ]]    # mic, resolved by name
  [[ "$argv" == *"-f avfoundation -i :2"* ]]    # BlackHole, resolved by name
  [[ "$argv" == *"$output/mic.wav"* ]]
  [[ "$argv" == *"$output/sys.wav"* ]]
}

@test "capture downmixes with pan, never -ac 1" {
  require_macos
  stub_ffmpeg

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill "$(awk '{ print $1 }' "$VOX_STATEFILE")" 2>/dev/null || true

  # ffmpeg reports BlackHole as 9.1.6, so -ac 1 applies a surround downmix
  # matrix instead of taking the stereo pair apps actually write.
  [[ "$argv" == *"pan=mono"* ]]
  [[ "$argv" != *"-ac 1"* ]]
}

@test "capture passes no -t: duration is driven by vox stop" {
  require_macos
  stub_ffmpeg

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill "$(awk '{ print $1 }' "$VOX_STATEFILE")" 2>/dev/null || true

  # -t misbehaves alongside -use_wallclock_as_timestamps: the first pts starts
  # at device uptime, so the recording is truncated to nothing.
  [[ "$argv" != *" -t "* ]]
  [[ "$argv" == *"-use_wallclock_as_timestamps 1"* ]]
}

@test "start refuses when the loopback device is absent" {
  require_macos
  stub_ffmpeg
  export VOX_SYS_DEVICE="NoSuchLoopback"

  vox

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
}

@test "start refuses a second capture while one is live" {
  require_macos
  stub_ffmpeg

  vox
  first=$output
  vox
  kill "$(awk '{ print $1 }' "$VOX_STATEFILE")" 2>/dev/null || true

  [ "$status" -ne 0 ]
  [ "$output" = "$first" ] # points at the recording already running
}

# --- stop: signal, transcription and merge ----------------------------------

@test "stop signals the capture with INT, never TERM" {
  require_macos
  stub_ffmpeg
  stub_mw

  vox
  vox stop

  # SIGTERM makes ffmpeg exit immediately, leaving a WAV with no valid header.
  grep -q '^ffmpeg-signal INT$' "$TEST_LOG"
  ! grep -q '^ffmpeg-signal TERM$' "$TEST_LOG"
}

@test "stop transcribes each track and merges them into transcript.md" {
  require_macos
  stub_mw
  stub_ffmpeg

  vox
  vox stop
  dir=$output

  [ "$status" -eq 0 ]
  [ -s "$dir/mic.json" ]
  [ -s "$dir/sys.json" ]
  [ "$(sed -n 1p "$dir/transcript.md")" = "[00:00:00] Me: hello there" ]
  [ "$(sed -n 2p "$dir/transcript.md")" = "[00:00:02] Speaker 1: yes hello" ]
  # --no-speakers on the mic track (it is definitionally you), --speakers on
  # the system track, and the model pinned per invocation.
  grep -q "^mw transcribe $dir/mic.wav --model .* --format json --no-speakers$" "$TEST_LOG"
  grep -q "^mw transcribe $dir/sys.wav --model .* --format json --speakers$" "$TEST_LOG"
}

@test "stop clears the state so the next status reads IDLE" {
  require_macos
  stub_ffmpeg
  stub_mw

  vox
  vox stop
  vox status

  [ "$output" = "IDLE" ]
}

@test "stop applies the vocabulary map to the transcript" {
  require_macos
  stub_ffmpeg
  write_stub mw <<'EOF'
#!/usr/bin/env bash
printf '{"segments":[{"id":0,"start":0,"end":1000,"text":"talking to admit today"}]}\n'
EOF
  printf 'admit\tAdmyt\n' >"$VOX_VOCAB"

  vox
  vox stop

  [[ "$(cat "$output/transcript.md")" == *"talking to Admyt today"* ]]
}

@test "stop fails cleanly when nothing is recording" {
  vox stop

  [ "$status" -ne 0 ]
}

# --- transcribing a file that already exists --------------------------------

@test "an existing audio file is transcribed into its own store directory" {
  stub_mw
  printf 'RIFF' >"$HOME/Team Sync.wav"

  vox "$HOME/Team Sync.wav"

  [ "$status" -eq 0 ]
  [[ "$(basename "$output")" == *-team-sync ]]
  [ -s "$output/mic.json" ]
  [ -s "$output/transcript.md" ]
  [ -L "$output/source.wav" ]
}

# --- compact / prune: reclaiming disk ---------------------------------------
#
# Selection is by the directory's TIMESTAMP PREFIX, not its mtime: transcribing,
# renaming and compacting all touch the directory long after the recording.

@test "compact selects only recordings older than the window" {
  old=$(aged_recording 60)
  recent=$(aged_recording 3)

  vox compact --dry-run

  [ "$status" -eq 0 ]
  [ "$output" = "$old" ]
  [[ "$stderr" != *"$(basename "$recent")"* ]]
}

@test "compact --dry-run reports the reclaimable bytes without touching files" {
  old=$(aged_recording 60)

  vox compact --dry-run

  [ -f "$old/mic.wav" ]
  [ ! -e "$old/mic.opus" ]
  [[ "$stderr" == *"dry run"* ]]
}

@test "the --older window is honoured, units included" {
  aged_recording 10 >/dev/null

  vox compact --older 2w --dry-run
  [ -z "$output" ] # 10 days is inside a 2-week window

  vox compact --older 1w --dry-run
  [ -n "$output" ]
}

@test "an unparseable --older value is an error, not a default" {
  old=$(aged_recording 60)

  vox compact --older forever

  [ "$status" -ne 0 ]
  [ -f "$old/mic.wav" ]
}

@test "an unknown reclaim option is rejected" {
  aged_recording 60 >/dev/null

  vox prune --oldest 5d

  [ "$status" -ne 0 ]
}

@test "compact re-encodes the WAV to Opus and drops the original" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  old=$(aged_recording 60)
  # A real (tiny) WAV, so this exercises the actual encode rather than asserting
  # on an argv string.
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=300:duration=1' \
    -ar 16000 -ac 1 -c:a pcm_s16le -y "$old/mic.wav"
  before=$(wc -c <"$old/mic.wav")

  vox compact --force

  [ "$status" -eq 0 ]
  [ ! -e "$old/mic.wav" ]
  [ -s "$old/mic.opus" ]
  [ "$(wc -c <"$old/mic.opus")" -lt "$before" ]
  [ -f "$old/transcript.md" ] # the artefact everything consumes survives
}

@test "compact keeps the WAV when the encode fails" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  old=$(aged_recording 60) # the placeholder WAV has no valid header

  vox compact --force

  [ -f "$old/mic.wav" ]
}

@test "prune deletes the audio and keeps the transcript and JSON" {
  old=$(aged_recording 120)

  vox prune --force

  [ "$status" -eq 0 ]
  [ ! -e "$old/mic.wav" ]
  [ -f "$old/transcript.md" ]
  [ -f "$old/mic.json" ]
}

@test "prune leaves a compacted recording's Opus in scope too" {
  old=$(aged_recording 120)
  mv "$old/mic.wav" "$old/mic.opus"

  vox prune --force

  [ ! -e "$old/mic.opus" ]
}

@test "declining the confirmation removes nothing" {
  old=$(aged_recording 120)

  vox_answer n prune

  [ "$status" -ne 0 ]
  [ -f "$old/mic.wav" ]
}

@test "accepting the confirmation removes the audio" {
  old=$(aged_recording 120)

  vox_answer y prune

  [ "$status" -eq 0 ]
  [ ! -e "$old/mic.wav" ]
}

@test "reclaim never touches the recording currently in progress" {
  old=$(aged_recording 120)
  sleep 100 &
  pid=$!
  printf '%s %s %s\n' "$pid" "$(date +%s)" "$old" >"$VOX_STATEFILE"

  vox prune --force
  kill "$pid" 2>/dev/null || true

  [ -f "$old/mic.wav" ]
}

@test "reclaim says so when there is nothing old enough" {
  aged_recording 1 >/dev/null

  vox prune

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *"nothing to prune"* ]]
}
