#!/usr/bin/env bats

# The prefix + Alt+v toggle: which of start/stop it picks, and the two orderings
# that make it usable — the capture starts BEFORE the title prompt, and stopping
# detaches instead of holding the key.
#
# A bare tmux server (`-f /dev/null`) so the real config's hooks cannot fire, and
# a `vox` stub so nothing here opens a microphone. Not integration-tagged: a bare
# server starts in ~1s.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

TOGGLE="$HOME/.config/tmux/scripts/vox-toggle.sh"
VOX_LIB_REAL="$HOME/.config/tmux/scripts/vox-lib.sh"
TMUX_BIN="$(command -v tmux)"

setup() {
  setup_test_home
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_STORE="$HOME/Recordings/vox"
  export VOX_BIN="$TEST_BIN/vox"
  mkdir -p "$HOME/.cache" "$VOX_STORE"

  SOCK="voxtoggle_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  PANE=$("$TMUX_BIN" -L "$SOCK" display-message -p '#{pane_id}')
  export TMUX_SOCKET="$SOCK"
  # The scripts call bare `tmux`, so route it at the private server.
  write_stub tmux <<EOF
#!/usr/bin/env bash
exec "$TMUX_BIN" -L "$SOCK" "\$@"
EOF
}

teardown() {
  [ -n "${SOCK:-}" ] && "$TMUX_BIN" -L "$SOCK" kill-server 2>/dev/null
  if [ -f "$VOX_STATEFILE" ]; then
    kill "$(awk 'NR == 1 { print $1 }' "$VOX_STATEFILE" | tr ',' ' ')" 2>/dev/null || true
  fi
  true
}

# stub_vox - a `vox` that records what it was asked and pretends to succeed. The
# start branch also writes the statefile with a live pid, because the toggle's
# next decision is made from the lib's view of that file, not from vox's output.
stub_vox() {
  write_stub vox <<'EOF'
#!/usr/bin/env bash
printf 'vox %s\n' "$*" >>"$TEST_LOG"
case "${1:-}" in
"")
  dir="$VOX_STORE/2026-07-28-140312"
  mkdir -p "$dir"
  sleep 30 >/dev/null 2>&1 &
  printf '%s %s %s\n' "$!" "$(date +%s)" "$dir" >"$VOX_STATEFILE"
  printf '%s\n' "$dir"
  ;;
stop)
  rm -f "$VOX_STATEFILE"
  [ -n "${VOX_STUB_STOP_FAILS:-}" ] && exit 1
  printf '%s\n' "$VOX_STORE/2026-07-28-140312"
  ;;
rename)
  printf 'renamed %s -> %s\n' "$2" "$3" >>"$TEST_LOG"
  printf '%s-%s\n' "$2" "$3"
  ;;
esac
EOF
}

# A capture the lib will read as live.
live_capture() {
  sleep 30 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/spawned"
  printf '%s %s %s\n' "$!" "$(date +%s)" "$VOX_STORE/2026-07-28-140312-standup" \
    >"$VOX_STATEFILE"
}

toggle() {
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" "$TOGGLE" "$@"
}

@test "idle starts a capture" {
  stub_vox

  toggle "$PANE"

  [ "$status" -eq 0 ]
  grep -q '^vox *$' "$TEST_LOG"
  [ -f "$VOX_STATEFILE" ]
}

@test "the title prompt is raised only after the capture is running" {
  stub_vox

  toggle "$PANE"

  # The prompt is the client's, so it survives as a pending command-prompt on
  # the server: whatever it asks for, audio is already being recorded.
  grep -q '^vox *$' "$TEST_LOG"
  # The recording exists on disk before any answer is given.
  [ -d "$VOX_STORE/2026-07-28-140312" ]
}

@test "the prompt callback renames the live recording" {
  stub_vox

  toggle name "$VOX_STORE/2026-07-28-140312" "Triver Kickoff"

  [ "$status" -eq 0 ]
  grep -q 'renamed .*2026-07-28-140312 -> Triver Kickoff' "$TEST_LOG"
}

@test "an empty title leaves the recording at its timestamp" {
  stub_vox

  toggle name "$VOX_STORE/2026-07-28-140312" ""

  # Escaping the prompt must not read as cancel, and must not rename to nothing.
  [ "$status" -eq 0 ]
  ! grep -q 'renamed' "$TEST_LOG"
}

@test "recording stops, and does not hold the key while transcribing" {
  stub_vox
  live_capture

  toggle "$PANE"

  # The toggle returns at once; the stop runs detached behind it.
  [ "$status" -eq 0 ]
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    grep -q '^vox stop$' "$TEST_LOG" && break
    sleep 0.2
  done
  grep -q '^vox stop$' "$TEST_LOG"
}

@test "a finished transcription says so" {
  stub_vox

  toggle finish "$VOX_STORE/2026-07-28-140312-standup" "$PANE"

  [ "$status" -eq 0 ]
  grep -q '^vox stop$' "$TEST_LOG"
}

@test "a failed transcription names the log and sets nothing ready" {
  stub_vox
  export VOX_STUB_STOP_FAILS=1
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" VOX_STUB_STOP_FAILS=1 \
    "$TOGGLE" finish "$VOX_STORE/2026-07-28-140312" "$PANE"

  [ "$status" -eq 0 ]
  # Nothing marks the seen file, so a later transcript can still read READY -
  # and the failure is reported rather than hanging as TRANSCRIBING.
  [ ! -f "$VOX_SEENFILE" ]
}

@test "pressing it while transcribing starts a new capture" {
  stub_vox
  sleep 30 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/spawned"
  printf '%s %s %s\n' "$!" "$(date +%s)" "$VOX_STORE/earlier" >"$VOX_JOBFILE"

  toggle "$PANE"

  # Transcription is per-directory and detached, so it never blocks the next
  # recording.
  grep -q '^vox *$' "$TEST_LOG"
  ! grep -q '^vox stop$' "$TEST_LOG"
}

@test "a refused start reports why instead of prompting for a title" {
  write_stub vox <<'EOF'
#!/usr/bin/env bash
printf 'vox %s\n' "$*" >>"$TEST_LOG"
printf 'vox: system audio capture is unavailable\n' >&2
exit 1
EOF

  toggle "$PANE"

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
}
