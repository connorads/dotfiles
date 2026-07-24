#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

LIB="$TESTS_DIR/../../tmux/scripts/agent-state-lib.sh"

# The cross-session attention rollup runs against a throwaway private tmux server
# (real infrastructure) so list-panes -a and the per-pane @agent_state read are
# computed by tmux exactly as in production. Bare `tmux` (as the lib invokes it)
# is pointed here via $TMUX. Two sessions (a, b) model the multi-session split.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentbadge_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: bare server (see AGENTS.md). The lib reads only @agent_state,
  # which the test sets itself; the real config adds nothing and its focus hooks
  # would contaminate the test.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s a -x 80 -y 24
  tx new-session -d -s b -x 80 -y 24
  TMUX="$(tx display-message -p -t a '#{socket_path}'),$(tx display-message -p -t a '#{pid}'),0"
  export TMUX
  # shellcheck disable=SC1090
  . "$LIB"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# set_state SESSION STATE — set @agent_state on session SESSION's sole pane.
set_state() {
  tx set-option -p -t "$(tx display-message -p -t "$1" '#{pane_id}')" @agent_state "$2"
}

@test "blocked elsewhere outranks done and counts both" {
  set_state a working # attached session: never counted
  tx split-window -t b
  set -- $(tx list-panes -t b -F '#{pane_id}')
  tx set-option -p -t "$1" @agent_state blocked
  tx set-option -p -t "$2" @agent_state done
  run other_sessions_badge a
  [ "$status" -eq 0 ]
  [ "$output" = "f38ba8 ◆ 2" ] # worst = blocked (red ◆), count = 2
}

@test "done-only elsewhere reports blue with its count" {
  set_state b done
  run other_sessions_badge a
  [ "$output" = "89b4fa ● 1" ]
}

@test "working/idle elsewhere are not attention states (not counted)" {
  tx split-window -t b
  set -- $(tx list-panes -t b -F '#{pane_id}')
  tx set-option -p -t "$1" @agent_state working
  tx set-option -p -t "$2" @agent_state idle
  run other_sessions_badge a
  [ -z "$output" ]
}

@test "agents only in the attached session produce no badge" {
  set_state a blocked
  run other_sessions_badge a
  [ -z "$output" ]
}

@test "no agents anywhere produces no badge" {
  run other_sessions_badge a
  [ -z "$output" ]
}

@test "@cross_session_badge off silences the badge" {
  tx set-option -g @cross_session_badge off
  set_state b blocked
  run other_sessions_badge a
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
