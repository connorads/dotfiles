#!/usr/bin/env bats

# The menu behind a click on the recording pill. The whole point is that its rows
# match the state, so that is what these assert - via a tmux stub capturing the
# display-menu argv, which is also the only way to see a menu without a client.
#
# Not integration-tagged: nothing here starts a server or spends real time.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$HOME/.config/tmux/scripts/vox-menu.sh"

setup() {
  setup_test_home
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_STORE="$HOME/Recordings/vox"
  mkdir -p "$HOME/.cache" "$VOX_STORE"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

teardown() {
  if [ -f "$BATS_TEST_TMPDIR/spawned" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done <"$BATS_TEST_TMPDIR/spawned"
  fi
  true
}

spawn() {
  sleep 100 >/dev/null 2>&1 &
  printf '%s\n' "$!" | tee -a "$BATS_TEST_TMPDIR/spawned"
}

recording_state() {
  printf '%s %s %s\n' "$(spawn)" "$(date +%s)" "$VOX_STORE/2026-07-28-140312-standup" \
    >"$VOX_STATEFILE"
}

transcribing_state() {
  printf '%s %s %s\n' "$(spawn)" "$(date +%s)" "$VOX_STORE/2026-07-28-140312" \
    >"$VOX_JOBFILE"
}

ready_state() {
  mkdir -p "$VOX_STORE/2026-07-28-140312"
  printf '[00:00:00] Me: hello\n' >"$VOX_STORE/2026-07-28-140312/transcript.md"
}

menu() {
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" TEST_LOG="$TEST_LOG" \
    "$MENU" "${1:-client0}" "${2:-10}" "${3:-S}"
}

@test "a live capture is offered stop, name, discard and the library" {
  recording_state

  menu

  [ "$status" -eq 0 ]
  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"Stop and transcribe"* ]] || false
  [[ "$rows" == *"Name…"* ]] || false
  [[ "$rows" == *"Discard without transcribing"* ]] || false
  [[ "$rows" == *"Recordings…"* ]]
}

@test "discarding is the only row that asks first" {
  recording_state

  menu

  rows=$(cat "$TEST_LOG")
  # It throws audio away, so it is confirmed; stopping only spends time.
  [[ "$rows" == *"confirm-before"*"cancel"* ]] || false
  [[ "$rows" != *"confirm-before"*"Stop and transcribe"* ]]
}

@test "transcribing offers only the library" {
  transcribing_state

  menu

  rows=$(cat "$TEST_LOG")
  # A Stop row with nothing to stop is the drift the one-lib rule exists to
  # prevent.
  [[ "$rows" == *"Recordings…"* ]] || false
  [[ "$rows" != *"Stop and transcribe"* ]] || false
  [[ "$rows" != *"Discard"* ]]
}

@test "a waiting transcript offers only the library" {
  ready_state

  menu

  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"Recordings…"* ]] || false
  [[ "$rows" != *"Stop and transcribe"* ]]
}

@test "the menu names the state it is offering rows for" {
  recording_state

  menu

  [[ "$(cat "$TEST_LOG")" == *"vox: recording"* ]]
}

@test "the menu opens where it was clicked, on the clicking client" {
  ready_state

  menu client7 42 S

  rows=$(cat "$TEST_LOG")
  [[ "$rows" == *"-c client7"* ]] || false
  [[ "$rows" == *"-x 42"* ]] || false
  [[ "$rows" == *"-y S"* ]]
}

@test "the name row prompts for a title against the live recording" {
  recording_state

  menu

  # The same prompt as the toggle's, applied to the directory the statefile
  # currently names - which a rename mid-capture keeps true.
  [[ "$(cat "$TEST_LOG")" == *"2026-07-28-140312-standup"* ]]
}

@test "the name row asks one question" {
  recording_state

  menu

  # `command-prompt -p` splits on commas into a sequence of prompts, so this
  # wording is two questions unless it is asked literally (`-l`).
  line=$(grep -m1 'command-prompt' "$TEST_LOG")
  [ -n "$line" ]
  prompt=${line#*-p }
  prompt=${prompt%%run-shell*}
  [[ "$line" == *" -l "* ]] || [[ "$prompt" != *,* ]]
}
