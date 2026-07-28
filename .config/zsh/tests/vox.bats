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
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_VOCAB="$HOME/vocab.tsv"
  mkdir -p "$HOME/.cache" "$VOX_STORE"
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

# voxtap stub: --check answers "is the tap usable" with its exit status
# (VOXTAP_STUB_UNAVAILABLE=1 makes it say no), otherwise it streams f32le zeros
# at the real rate until the reader goes away.
#
# Python for the same reason the ffmpeg stub is: it has to emit binary at a
# genuine 48 kHz, which no shell fake can model. It also has to die quietly on a
# closed pipe, which is exactly how the real one is reaped.
stub_voxtap() {
  write_stub voxtap <<'EOF'
#!/usr/bin/env python3
import os
import sys
import time

argv = sys.argv[1:]
with open(os.environ["TEST_LOG"], "a") as fh:
    fh.write(" ".join(["voxtap", *argv]) + "\n")

if "--check" in argv:
    sys.exit(1 if os.environ.get("VOXTAP_STUB_UNAVAILABLE") else 0)

chunk = b"\x00" * (4 * 4800)  # 100 ms of 48 kHz mono float32
try:
    while True:
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        time.sleep(0.1)
except (BrokenPipeError, KeyboardInterrupt):
    pass
EOF
}

# kill_capture - reap every process a start left behind. The statefile's first
# field is a comma-separated pid list (mic capture first, system capture second).
kill_capture() {
  [ -f "${VOX_STATEFILE:-}" ] || return 0
  local pids
  pids=$(awk 'NR == 1 { print $1 }' "$VOX_STATEFILE" | tr ',' ' ')
  # shellcheck disable=SC2086  # deliberate word splitting: one kill for the set
  kill $pids 2>/dev/null || true
}

# Reap any capture a test left running, so a failure cannot leak a process.
teardown() {
  kill_capture
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

@test "start launches one capture per source and records both pids" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  micargv=$(grep '^ffmpeg ' "$TEST_LOG" | grep avfoundation | grep -v list_devices)
  sysargv=$(grep '^ffmpeg ' "$TEST_LOG" | grep f32le)
  kill_capture

  [ "$status" -eq 0 ]
  [ "$(grep -c '^ffmpeg ' "$TEST_LOG")" -eq 3 ] # listing probe, mic, system
  [[ "$micargv" == *"-f avfoundation -i :0"* ]] # mic, resolved by name
  [[ "$micargv" == *"$output/mic.wav"* ]]
  [[ "$micargv" != *"sys.wav"* ]]
  # System audio is voxtap on a pipe, at the format voxtap fixes: no device
  # lookup, no BlackHole, nothing to route by hand.
  [[ "$sysargv" == *"-f f32le -ar 48000 -ac 1 -i /dev/fd/"* ]]
  [[ "$sysargv" == *"$output/sys.wav"* ]]
  # Leader first, so a reader that wants "is it recording" reads the mic.
  [[ "$(awk '{ print $1 }' "$VOX_STATEFILE")" == *,* ]]
}

@test "the system capture starts only once the microphone is open" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  kill_capture

  # While a process tap is live, avfoundation blocks on opening any audio
  # input, so a tap created first would hang the mic capture forever.
  micline=$(grep -n '^ffmpeg .*avfoundation -i :0' "$TEST_LOG" | grep -v list_devices | cut -d: -f1)
  tapline=$(grep -n '^voxtap$' "$TEST_LOG" | cut -d: -f1)
  [ -n "$micline" ]
  [ -n "$tapline" ]
  [ "$micline" -lt "$tapline" ]
}

@test "start verifies the tap before opening a recording" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  kill_capture

  grep -q '^voxtap --check$' "$TEST_LOG"
}

@test "capture downmixes the mic with pan, never -ac 1" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill_capture

  # A mic ffmpeg reports as multichannel would get a surround downmix matrix
  # from -ac 1 instead of the channel apps actually write. The tap needs none of
  # this: it is mono at source, so the only -ac 1 here is the pipe's format.
  [[ "$argv" == *"pan=mono"* ]]
  [[ "$argv" != *"avfoundation -i :0 -ac 1"* ]]
}

@test "capture passes no -t: duration is driven by vox stop" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill_capture

  # -t misbehaves alongside -use_wallclock_as_timestamps: the first pts starts
  # at device uptime, so the recording is truncated to nothing.
  [[ "$argv" != *" -t "* ]]
  [[ "$argv" == *"-use_wallclock_as_timestamps 1 -f avfoundation"* ]]
}

@test "the wallclock timestamp flag is never applied to the pipe" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill_capture

  # Same first-pts trap as -t, and on a pipe it produces an empty output file.
  [[ "$argv" != *"-use_wallclock_as_timestamps 1 -f f32le"* ]]
}

@test "start refuses when system audio capture is unavailable" {
  require_macos
  stub_ffmpeg
  stub_voxtap
  export VOXTAP_STUB_UNAVAILABLE=1

  vox

  # A meeting half-captured by accident is worse than one not started.
  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
  [ -z "$(find "$VOX_STORE" -mindepth 1 -maxdepth 1)" ]
}

@test "start refuses when the helper is not installed" {
  require_macos
  stub_ffmpeg
  export VOX_VOXTAP=definitely-not-installed

  vox

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
}

@test "VOX_MIC_ONLY records the mic alone, with no tap and no sys track" {
  require_macos
  stub_ffmpeg
  export VOX_VOXTAP=definitely-not-installed
  export VOX_MIC_ONLY=1

  vox
  argv=$(grep '^ffmpeg ' "$TEST_LOG" | grep -v list_devices)
  kill_capture

  [ "$status" -eq 0 ]
  [[ "$argv" == *"$output/mic.wav"* ]]
  [[ "$argv" != *"sys.wav"* ]]
  [[ "$argv" != *"f32le"* ]]
}

@test "start refuses a second capture while one is live" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  first=$output
  vox
  kill_capture

  [ "$status" -ne 0 ]
  [ "$output" = "$first" ] # points at the recording already running
}

# --- titles: --name, and renaming a live capture ----------------------------

@test "--name titles the recording at the moment it starts" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox --name "Triver Kickoff"
  kill_capture

  [ "$status" -eq 0 ]
  [[ "$(basename "$output")" == *-triver-kickoff ]]
}

@test "a bare argument is still a file to transcribe, never a title" {
  # Why --name is a flag: the *) branch treats a bare argument as a file, so a
  # mistyped path would silently become a title and record nothing.
  vox "Triver Kickoff"

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
}

@test "renaming the live recording moves the statefile with it" {
  require_macos
  stub_ffmpeg
  stub_voxtap

  vox
  dir=$output
  vox rename "$dir" "mid flight"
  renamed=$output
  kill_capture

  # ffmpeg's fds follow the inode, so the capture is unharmed - but the pill and
  # `vox stop` read the statefile, which would otherwise point at a dead path.
  [ "$status" -eq 0 ]
  [ -d "$renamed" ]
  [ "$(awk '{ print $3 }' "$VOX_STATEFILE")" = "$renamed" ]
}

# --- cancel: stop without transcribing --------------------------------------

@test "cancel stops the capture and removes the recording" {
  require_macos
  stub_ffmpeg
  stub_mw
  stub_voxtap

  vox
  dir=$output
  vox cancel

  [ "$status" -eq 0 ]
  [ ! -d "$dir" ]
  [ ! -f "$VOX_STATEFILE" ]
  ! grep -q '^mw ' "$TEST_LOG"
}

@test "cancel fails cleanly when nothing is recording" {
  vox cancel

  [ "$status" -ne 0 ]
}

# --- stop: signal, transcription and merge ----------------------------------

@test "stop signals the capture with INT, never TERM" {
  require_macos
  stub_ffmpeg
  stub_mw
  stub_voxtap

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
  stub_voxtap

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

@test "stop clears the capture state and leaves a transcript to read" {
  require_macos
  stub_ffmpeg
  stub_mw
  stub_voxtap

  vox
  vox stop
  vox status

  # Not IDLE: the capture is over and the transcript it produced is newer than
  # the seen marker, which is exactly what READY means. Opening the picker (or
  # starting the next recording) clears it.
  [ "$output" = "READY 1" ]
}

@test "stop leaves no transcribe job behind" {
  require_macos
  stub_ffmpeg
  stub_mw
  stub_voxtap

  vox
  vox stop

  # The job file exists only while mw is running, so nothing can be left
  # claiming to transcribe.
  [ ! -f "$VOX_JOBFILE" ]
}

@test "starting a capture marks earlier recordings as looked at" {
  require_macos
  stub_ffmpeg
  stub_voxtap
  recording 2026-07-26-090000-standup
  vox status
  [ "$output" = "READY 1" ] # unread before

  vox
  kill_capture
  vox status

  # Starting a new recording means you have moved on from the pile: the state
  # is about this capture, not about what was waiting.
  [ "$output" = "IDLE" ]
}

@test "stop applies the vocabulary map to the transcript" {
  require_macos
  stub_ffmpeg
  stub_voxtap
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

# --- prune --empty: selection by content, not age ---------------------------
#
# Real audio, generated by ffmpeg: the whole point is that loudness is measured
# rather than recorded, so a fake would only be testing the fake.

# two_track_recording DIR_SUFFIX MIC_SOURCE SYS_SOURCE - a recording whose two
# tracks are built from lavfi sources (sine=... / anullsrc=...).
two_track_recording() {
  local dir="$VOX_STORE/2026-07-2$1-140312" src
  mkdir -p "$dir"
  for src in "mic:$2" "sys:$3"; do
    ffmpeg -hide_banner -loglevel error -f lavfi -i "${src#*:}" -t 1 \
      -ar 16000 -ac 1 -c:a pcm_s16le -y "$dir/${src%%:*}.wav"
  done
  printf '[00:00:00] Me: hello\n' >"$dir/transcript.md"
  printf '%s\n' "$dir"
}

@test "prune --empty deletes the silent track and keeps the spoken one" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  dir=$(two_track_recording 0 'sine=frequency=300' 'anullsrc=r=16000:cl=mono')

  vox prune --empty --force

  [ "$status" -eq 0 ]
  [ ! -e "$dir/sys.wav" ]
  [ -s "$dir/mic.wav" ]
  [ -f "$dir/transcript.md" ]
}

@test "prune --empty ignores a recording where both sides spoke" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  dir=$(two_track_recording 1 'sine=frequency=300' 'sine=frequency=440')

  vox prune --empty --force

  [ "$status" -eq 0 ]
  [ -s "$dir/mic.wav" ]
  [ -s "$dir/sys.wav" ]
}

@test "prune --empty leaves a recording whose every track is silent" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  # Nothing was captured at all, which is a delete-the-recording decision, not
  # a reclaim one - so it is never made on your behalf.
  dir=$(two_track_recording 2 'anullsrc=r=16000:cl=mono' 'anullsrc=r=16000:cl=mono')

  vox prune --empty --force

  [ -s "$dir/mic.wav" ]
  [ -s "$dir/sys.wav" ]
}

@test "prune --empty ignores age unless a window is given" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  # Today's recording: the 90-day default would exclude it, but silence is the
  # selector here, not age.
  dir="$VOX_STORE/$(date '+%Y-%m-%d-%H%M%S')"
  mkdir -p "$dir"
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=300' -t 1 \
    -ar 16000 -ac 1 -c:a pcm_s16le -y "$dir/mic.wav"
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'anullsrc=r=16000:cl=mono' -t 1 \
    -ar 16000 -ac 1 -c:a pcm_s16le -y "$dir/sys.wav"

  vox prune --empty --force

  [ ! -e "$dir/sys.wav" ]
  [ -s "$dir/mic.wav" ]
}

@test "compact refuses --empty: silence is not worth re-encoding" {
  vox compact --empty

  [ "$status" -ne 0 ]
}

@test "reclaim says so when there is nothing old enough" {
  aged_recording 1 >/dev/null

  vox prune

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *"nothing to prune"* ]]
}

# --- reclaiming recordings you name ------------------------------------------

@test "prune takes explicit recordings, ignoring the age window" {
  old=$(aged_recording 120)
  fresh=$(aged_recording 1)

  vox prune --force "$fresh"

  # You chose it, so its age is not a second opinion to overrule you with.
  [ "$status" -eq 0 ]
  [ ! -e "$fresh/mic.wav" ]
  [ -f "$fresh/transcript.md" ]
  [ -f "$old/mic.wav" ] # untouched: it was not named
}

@test "a named recording that does not exist is an error, not a silent skip" {
  vox prune --force "$VOX_STORE/2026-07-28-999999"

  [ "$status" -ne 0 ]
}

@test "the live recording is spared even when named" {
  old=$(aged_recording 120)
  sleep 100 &
  pid=$!
  printf '%s %s %s\n' "$pid" "$(date +%s)" "$old" >"$VOX_STATEFILE"

  vox prune --force "$old"
  kill "$pid" 2>/dev/null || true

  [ -f "$old/mic.wav" ]
}
