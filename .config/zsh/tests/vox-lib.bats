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
  mkdir -p "$HOME/.cache"
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
  statefile 123 "$(($(date +%s) - 720))" "$HOME/rec"
  lib vox_token
  [ "$output" = "12m" ]
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
