#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it
# for an isolated temp dir. The lib is sourced against the isolated HOME; state
# is driven with real statefiles under VOX_STATEFILE (env-overridable default),
# with a start_epoch in the past — so no clock stubbing is needed.
VOX_LIB="$HOME/.config/tmux/scripts/vox-lib.sh"
FIXTURES="$BATS_TEST_DIRNAME/fixtures"

setup() {
  setup_test_home
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_STORE="$HOME/Recordings/vox"
  mkdir -p "$HOME/.cache" "$VOX_STORE"
}

# Write "pid start_epoch dir" to the transcribe-job file.
jobfile() {
  printf '%s %s %s\n' "$1" "$2" "$3" >"$VOX_JOBFILE"
}

# transcript NAME - a finished recording in the store. Ages are set with touch,
# so the seen-marker comparison runs against real mtimes and no clock is mocked.
transcript() {
  mkdir -p "$VOX_STORE/$1"
  printf '[00:00:00] Me: hello\n' >"$VOX_STORE/$1/transcript.md"
  printf '%s\n' "$VOX_STORE/$1/transcript.md"
}

# spawn - a live process whose pid the test can record, reaped by teardown.
#
# stdout and stderr are redirected because spawn is called inside a command
# substitution: a background child inheriting that pipe holds it open, so the
# substitution would block until the sleep finished rather than returning a pid.
# The pid list goes through a file for the same reason - a variable set inside
# the substitution's subshell never reaches teardown.
spawn() {
  sleep 100 >/dev/null 2>&1 &
  printf '%s\n' "$!" | tee -a "$BATS_TEST_TMPDIR/spawned"
}

teardown() {
  if [ -f "$BATS_TEST_TMPDIR/spawned" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done <"$BATS_TEST_TMPDIR/spawned"
  fi
  true
}

lib() {
  run bash -c "source '$VOX_LIB'; $*"
}

# lib_stdin FIXTURE FUNC... — run a lib function with a fixture on stdin.
lib_stdin() {
  local fixture=$1
  shift
  run bash -c "source '$VOX_LIB'; $* <'$fixture'"
}

# Write "pid start_epoch dir" to the statefile.
statefile() {
  printf '%s %s %s\n' "$1" "$2" "$3" >"$VOX_STATEFILE"
}

# --- statefile default resolution -------------------------------------------

@test "VOX_STATEFILE honours an env override" {
  VOX_STATEFILE="$HOME/custom.state" lib 'printf %s "$VOX_STATEFILE"'
  [ "$output" = "$HOME/custom.state" ]
}

@test "VOX_STATEFILE defaults under ~/.cache when unset" {
  run bash -c "unset VOX_STATEFILE; source '$VOX_LIB'; printf %s \"\$VOX_STATEFILE\""
  [ "$output" = "$HOME/.cache/tmux-vox.state" ]
}

@test "VOX_STORE defaults to the Recordings store when unset" {
  run bash -c "unset VOX_STORE; source '$VOX_LIB'; printf %s \"\$VOX_STORE\""
  [ "$output" = "$HOME/Recordings/vox" ]
}

# --- state: liveness of the capture pid -------------------------------------

@test "IDLE when no statefile exists" {
  lib vox_state
  [ "$output" = "IDLE" ]
}

@test "IDLE for a stale statefile whose pid is dead" {
  # Spawn a process, record its pid, then kill+reap it so the state is stale.
  sleep 100 &
  dead=$!
  kill "$dead" 2>/dev/null || true
  wait "$dead" 2>/dev/null || true
  statefile "$dead" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "IDLE" ]
}

@test "RECORDING for a live capture pid" {
  sleep 100 &
  pid=$!
  statefile "$pid" "$(date +%s)" "$HOME/rec"
  lib vox_state
  kill "$pid" 2>/dev/null || true
  [ "$output" = "RECORDING" ]
}

@test "the recording directory is readable from the statefile" {
  statefile 123 "$(date +%s)" "$HOME/Recordings/vox/2026-07-28-140312-triver kickoff"
  lib vox_dir
  # `read` puts the whole remainder in the last field, so spaces survive.
  [ "$output" = "$HOME/Recordings/vox/2026-07-28-140312-triver kickoff" ]
}

# --- the pid list: mic capture first, system capture second -----------------

@test "the leader pid is the first of the list" {
  statefile 4242,4243 "$(date +%s)" "$HOME/rec"
  lib vox_pid
  [ "$output" = "4242" ]
}

@test "every capture pid is readable, space-separated" {
  statefile 4242,4243 "$(date +%s)" "$HOME/rec"
  lib vox_pids
  [ "$output" = "4242 4243" ]
}

@test "state follows the leader, not the system capture" {
  # The mic capture is what "recording" means: a system capture that died
  # leaves a live recording, while a dead mic leaves nothing worth showing.
  sleep 100 &
  leader=$!
  sleep 100 &
  follower=$!
  kill "$follower" 2>/dev/null || true
  wait "$follower" 2>/dev/null || true
  statefile "$leader,$follower" "$(date +%s)" "$HOME/rec"
  lib vox_state
  kill "$leader" 2>/dev/null || true
  [ "$output" = "RECORDING" ]
}

@test "a single pid still reads as the leader" {
  statefile 4242 "$(date +%s)" "$HOME/rec"
  lib vox_pid
  [ "$output" = "4242" ]
  lib vox_pids
  [ "$output" = "4242" ]
}

@test "write_state then clear_state round-trips the state" {
  lib 'vox_write_state 4242 111 /tmp/rec; vox_pid'
  [ "$output" = "4242" ]
  lib 'vox_clear_state; vox_state'
  [ "$output" = "IDLE" ]
}

# --- the four states, and their precedence -----------------------------------

@test "TRANSCRIBING while the transcribe job's pid is alive" {
  jobfile "$(spawn)" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "TRANSCRIBING" ]
}

@test "a dead transcribe job reads as finished, not stuck" {
  # mw crashed, or the machine rebooted: pid liveness self-clears the state, so
  # there is no reaper and no way to be pinned at TRANSCRIBING forever.
  sleep 100 &
  dead=$!
  kill "$dead" 2>/dev/null || true
  wait "$dead" 2>/dev/null || true
  jobfile "$dead" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "IDLE" ]
}

@test "READY when a transcript is newer than the seen marker" {
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  transcript 2026-07-28-140312 >/dev/null
  lib vox_state
  [ "$output" = "READY" ]
}

@test "not READY when the marker is newer than every transcript" {
  transcript 2026-07-28-140312 >/dev/null
  : >"$VOX_SEENFILE" # touched last, so it wins
  lib vox_state
  [ "$output" = "IDLE" ]
}

@test "READY counts every transcript finished since you last looked" {
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  transcript 2026-07-28-140312 >/dev/null
  transcript 2026-07-28-150000 >/dev/null
  lib vox_unread_count
  [ "$output" = "2" ]
}

@test "an empty transcript does not count as ready to read" {
  # A failed merge still leaves the file behind; there is nothing to go and read.
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  mkdir -p "$VOX_STORE/2026-07-28-140312"
  : >"$VOX_STORE/2026-07-28-140312/transcript.md"
  lib vox_unread_count
  [ "$output" = "0" ]
}

# --- EMPTY: a recording that transcribed to nothing --------------------------

# empty NAME - a finished recording whose transcript came back with nothing in
# it. `vox stop` reports this as a failure; the pill has to say so too, or it
# drops straight back to IDLE as if nothing had happened.
empty() {
  mkdir -p "$VOX_STORE/$1"
  : >"$VOX_STORE/$1/transcript.md"
  printf '%s\n' "$VOX_STORE/$1/transcript.md"
}

@test "EMPTY when a transcript newer than the marker has nothing in it" {
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  empty 2026-07-28-140312 >/dev/null
  lib vox_state
  [ "$output" = "EMPTY" ]
}

@test "empty transcripts are counted, marker or no marker" {
  empty 2026-07-28-140312 >/dev/null
  empty 2026-07-28-150000 >/dev/null
  lib vox_empty_count
  [ "$output" = "2" ] # no marker at all: nothing has been looked at yet
  : >"$VOX_SEENFILE"
  lib vox_empty_count
  [ "$output" = "0" ]
}

@test "a transcript with content is not counted as empty" {
  # The two counts mirror each other, so every finished transcript lands in
  # exactly one of them.
  transcript 2026-07-28-140312 >/dev/null
  lib vox_empty_count
  [ "$output" = "0" ]
  lib vox_unread_count
  [ "$output" = "1" ]
}

@test "empty outranks ready" {
  # The recording that produced nothing is the one that needs you; the good one
  # is still there once the picker clears both from the same marker.
  transcript 2026-07-28-140312 >/dev/null
  empty 2026-07-28-150000 >/dev/null
  lib vox_state
  [ "$output" = "EMPTY" ]
}

@test "transcribing outranks empty" {
  empty 2026-07-28-140312 >/dev/null
  jobfile "$(spawn)" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "TRANSCRIBING" ]
}

@test "touching the seen marker clears EMPTY too" {
  empty 2026-07-28-140312 >/dev/null
  lib 'vox_touch_seen; vox_state'
  [ "$output" = "IDLE" ]
}

@test "EMPTY is red, with its own glyph and the count as its token" {
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  empty 2026-07-28-140312 >/dev/null
  lib 'vox_state_colour EMPTY'
  [ "$output" = "f38ba8" ]
  lib 'vox_state_glyph EMPTY'
  [ "$output" = "!" ]
  lib 'vox_token EMPTY'
  [ "$output" = "1" ]
}

@test "touching the seen marker clears READY" {
  transcript 2026-07-28-140312 >/dev/null
  lib vox_state
  [ "$output" = "READY" ] # no marker at all: everything is unread
  lib 'vox_touch_seen; vox_state'
  [ "$output" = "IDLE" ]
}

@test "recording outranks transcribing, ready and idle" {
  jobfile "$(spawn)" "$(date +%s)" "$HOME/rec"
  transcript 2026-07-28-140312 >/dev/null
  statefile "$(spawn)" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "RECORDING" ]
}

@test "transcribing outranks ready" {
  # The recording that just finished is exactly the one being transcribed, so
  # showing it as ready to read would be a lie for the length of the job.
  transcript 2026-07-28-140312 >/dev/null
  jobfile "$(spawn)" "$(date +%s)" "$HOME/rec"
  lib vox_state
  [ "$output" = "TRANSCRIBING" ]
}

@test "the transcribing token is the job's elapsed time" {
  jobfile "$(spawn)" "$(($(date +%s) - 90))" "$HOME/rec"
  lib 'vox_token TRANSCRIBING'
  [ "$output" = "1m" ]
}

@test "the ready token is the number waiting" {
  : >"$VOX_SEENFILE"
  touch -t 202607010000 "$VOX_SEENFILE"
  transcript 2026-07-28-140312 >/dev/null
  lib 'vox_token READY'
  [ "$output" = "1" ]
}

@test "the transcribed recording is readable from the job file" {
  jobfile 123 "$(date +%s)" "$HOME/Recordings/vox/2026-07-28-140312-triver kickoff"
  lib vox_job_dir
  [ "$output" = "$HOME/Recordings/vox/2026-07-28-140312-triver kickoff" ]
}

@test "TRANSCRIBING and READY carry their own glyph, RECORDING keeps the tilde" {
  lib 'vox_state_glyph TRANSCRIBING'
  [ "$output" = "≈" ]
  lib 'vox_state_glyph READY'
  [ "$output" = "✓" ]
  lib 'vox_state_glyph RECORDING'
  [ "$output" = "~" ]
}

@test "READY is the agent-dot unread blue; the working states stay muted" {
  lib 'vox_state_colour READY'
  [ "$output" = "89b4fa" ]
  lib 'vox_state_colour TRANSCRIBING'
  [ "$output" = "a6adc8" ]
}

# --- elapsed time -----------------------------------------------------------

@test "elapsed is measured from the recorded start epoch" {
  statefile 123 "$(($(date +%s) - 120))" "$HOME/rec"
  lib vox_elapsed_secs
  [ "$output" -ge 120 ]
  [ "$output" -lt 130 ]
}

@test "elapsed is 0 when there is no statefile" {
  lib vox_elapsed_secs
  [ "$output" = "0" ]
}

@test "elapsed clamps a future start epoch to 0" {
  statefile 123 "$(($(date +%s) + 600))" "$HOME/rec"
  lib vox_elapsed_secs
  [ "$output" = "0" ]
}

@test "elapsed is 0 for a non-numeric start epoch" {
  statefile 123 nonsense "$HOME/rec"
  lib vox_elapsed_secs
  [ "$output" = "0" ]
}

# --- token, colour and glyph vocabulary -------------------------------------

@test "token is the human elapsed time" {
  # A live pid, because the token now follows the state: a dead capture is IDLE,
  # and IDLE has nothing to say.
  statefile "$(spawn)" "$(($(date +%s) - 720))" "$HOME/rec"
  lib vox_token
  [ "$output" = "12m" ]
}

@test "an idle token is empty" {
  lib vox_token
  [ -z "$output" ]
}

@test "RECORDING maps to the muted subtext0 pill colour" {
  lib 'vox_state_colour RECORDING'
  [ "$output" = "a6adc8" ]
}

@test "glyph is a plain ASCII tilde" {
  lib 'vox_state_glyph RECORDING'
  [ "$output" = "~" ]
}

@test "glyph honours a VOX_GLYPH override" {
  VOX_GLYPH="●" lib 'vox_state_glyph RECORDING'
  [ "$output" = "●" ]
}

@test "human age renders seconds, minutes, hours and days" {
  lib 'vox_human_age 5'
  [ "$output" = "5s" ]
  lib 'vox_human_age 125'
  [ "$output" = "2m" ]
  lib 'vox_human_age 7200'
  [ "$output" = "2h" ]
  lib 'vox_human_age 172800'
  [ "$output" = "2d" ]
}

# --- pure parser: audio device index ----------------------------------------
#
# Driven by a captured `ffmpeg -list_devices` listing, so device resolution is
# tested with no audio hardware at all.

@test "device index resolves an audio input by name" {
  lib_stdin "$FIXTURES/vox-avfoundation-devices.txt" vox_audio_device_index BlackHole
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
}

@test "device index ignores the video section, whose indices repeat" {
  # "Logitech BRIO" is video [0] and audio [3]; only the audio index is valid.
  lib_stdin "$FIXTURES/vox-avfoundation-devices.txt" vox_audio_device_index "Logitech BRIO"
  [ "$output" = "3" ]
}

@test "device index matches the first audio device containing the name" {
  lib_stdin "$FIXTURES/vox-avfoundation-devices.txt" vox_audio_device_index Microphone
  [ "$output" = "0" ]
}

@test "device index fails when nothing matches" {
  lib_stdin "$FIXTURES/vox-avfoundation-devices.txt" vox_audio_device_index Soundflower
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# --- solo / 2-way, derived from the system track's transcript ---------------

@test "a system track with segments makes the session 2-way" {
  mkdir -p "$HOME/rec"
  printf '{"segments":[{"id":0,"start":0,"end":1,"text":"yes hello"}]}' >"$HOME/rec/sys.json"
  lib "vox_session_kind '$HOME/rec'"
  [ "$output" = "2-way" ]
}

@test "a system track with no segments makes the session solo" {
  mkdir -p "$HOME/rec"
  printf '{"segments":[]}' >"$HOME/rec/sys.json"
  lib "vox_session_kind '$HOME/rec'"
  [ "$output" = "solo" ]
}

@test "mw's own empty output reads solo, top-level text key and all" {
  # Byte-for-byte what `mw transcribe` writes for a track nobody spoke on:
  # pretty-printed, and carrying a TOP-LEVEL "text" key that is present but
  # empty. Looking for the word "text" called every silent system track 2-way,
  # and the hand-written fixture above could not have caught it.
  mkdir -p "$HOME/rec"
  cat >"$HOME/rec/sys.json" <<'JSON'
{
  "segments" : [

  ],
  "text" : ""
}
JSON
  lib "vox_session_kind '$HOME/rec'"
  [ "$output" = "solo" ]
}

@test "mw's pretty-printed segments still read 2-way" {
  mkdir -p "$HOME/rec"
  cat >"$HOME/rec/sys.json" <<'JSON'
{
  "segments" : [
    {
      "id" : 0,
      "start" : 0,
      "end" : 1000,
      "text" : "yes hello"
    }
  ],
  "text" : "yes hello"
}
JSON
  lib "vox_session_kind '$HOME/rec'"
  [ "$output" = "2-way" ]
}

@test "no system track at all reads solo, not an error" {
  # What VOX_MIC_ONLY=1 produces, and what a recording pruned back to its
  # transcript still reads as.
  mkdir -p "$HOME/rec"
  lib "vox_session_kind '$HOME/rec'"
  [ "$status" -eq 0 ]
  [ "$output" = "solo" ]
}

# --- pure parser: track loudness / session classification -------------------

@test "mean volume is read from volumedetect output" {
  lib_stdin "$FIXTURES/vox-volumedetect-speech.txt" vox_mean_volume
  [ "$status" -eq 0 ]
  [ "$output" = "-27.3" ]
}

@test "mean volume fails when the measurement is absent" {
  lib_stdin "$FIXTURES/vox-avfoundation-devices.txt" vox_mean_volume
  [ "$status" -ne 0 ]
}

@test "a silent system track classifies as a monologue" {
  lib_stdin "$FIXTURES/vox-volumedetect-silent.txt" vox_classify_track
  [ "$output" = "MONOLOGUE" ]
}

@test "an audible system track classifies as a meeting" {
  lib_stdin "$FIXTURES/vox-volumedetect-speech.txt" vox_classify_track
  [ "$output" = "MEETING" ]
}

@test "an unmeasurable track classifies as a monologue, not an error" {
  run bash -c "source '$VOX_LIB'; printf '' | vox_classify_track"
  [ "$status" -eq 0 ]
  [ "$output" = "MONOLOGUE" ]
}

@test "the silence floor is env-overridable" {
  VOX_SILENCE_DB=-20 lib_stdin "$FIXTURES/vox-volumedetect-speech.txt" vox_classify_track
  [ "$output" = "MONOLOGUE" ]
}

@test "the floor sits between digital silence and a quiet room" {
  # Measured on real recordings: a system track that captured nothing reads
  # -91 dB, a microphone in a quiet room about -55 dB. A floor above the latter
  # makes prune --empty treat every monologue as "captured nothing" and skip it.
  lib 'printf %s "$VOX_SILENCE_DB"'
  [ "$output" -lt -70 ] || [ "$output" -eq -70 ]
  [ "$output" -gt -91 ]
}
