#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
load test_helper

AGENT="$FUNCTIONS_DIR/agents/agent"

tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  setup_test_home
  SOCK="recover_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s recovery
  TMUX="$(tx display-message -p -t recovery '#{socket_path}'),$(tx display-message -p -t recovery '#{pid}'),0"
  export TMUX
  PANE="$(tx display-message -p -t recovery '#{pane_id}')"
  tx set-option -p -t "$PANE" @agent_state working
  tx set-option -p -t "$PANE" @agent_name recovery
  export AGENT_CLI_LIB="$TESTS_DIR/../../tmux/scripts/agent-cli-lib.sh"
  export AGENT_STATE_LIB="$TESTS_DIR/../../tmux/scripts/agent-state-lib.sh"
  export RECOVER_LOG="$BATS_TEST_TMPDIR/recover.log"
  export AGENT_RECOVER_PYTHON="$TEST_BIN/recovery-python"
  write_stub recovery-python <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$RECOVER_LOG"
printf '%s\n' watching
exit "${RECOVER_EXIT:-0}"
EOF
}

teardown() { stop_private_server; }

@test "recover on resolves an agent name and delegates one canonical pane" {
  run "$AGENT" recover on recovery
  [ "$status" -eq 0 ]
  [ "$output" = watching ]
  [ "$(cat "$RECOVER_LOG")" = "$(printf '%s\n' -m codex_recover on --pane "$PANE")" ]
}

@test "recover status without target lists records without resolving a pane" {
  run "$AGENT" recover status
  [ "$status" -eq 0 ]
  [ "$(cat "$RECOVER_LOG")" = "$(printf '%s\n' -m codex_recover status)" ]
}

@test "recover off accepts a tmux address" {
  address="$(tx display-message -p -t "$PANE" '#{session_name}:#{window_index}.#{pane_index}')"
  run "$AGENT" recover off "$address"
  [ "$status" -eq 0 ]
  [ "$(cat "$RECOVER_LOG")" = "$(printf '%s\n' -m codex_recover off --pane "$PANE")" ]
}

@test "recover status accepts a pane id" {
  run "$AGENT" recover status "$PANE"
  [ "$status" -eq 0 ]
  [ "$(tail -n 1 "$RECOVER_LOG")" = "$PANE" ]
}

@test "recover rejects missing targets and unsupported options" {
  run -2 "$AGENT" recover on
  run -2 "$AGENT" recover off
  run -2 "$AGENT" recover unknown
  run -2 "$AGENT" recover status --json
  run -2 "$AGENT" recover on recovery extra
  [ ! -e "$RECOVER_LOG" ]
}

@test "recover preserves resolver and worker failures" {
  run -3 "$AGENT" recover on absent
  [ ! -e "$RECOVER_LOG" ]
  export RECOVER_EXIT=1
  run -1 "$AGENT" recover on recovery
}

@test "agent help advertises all recovery commands" {
  run "$AGENT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"recover on <target>"* ]]
  [[ "$output" == *"recover status [<target>]"* ]]
  [[ "$output" == *"recover off <target>"* ]]
}
