#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-popup.sh"

# A throwaway private tmux server started with `-f /dev/null` (no real config) so
# jump's explicit `seen` call is what ages done → idle, not the real config's
# focus hooks. Bare `tmux` (as the script invokes it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentpopup_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  # No sweep during pick (keeps list tests deterministic); resolve the seen helper
  # from the repo so jump can age done → idle.
  export AGENT_SWEEP=/nonexistent
  export AGENT_STATE_SH="$TESTS_DIR/../../tmux/scripts/agent-state.sh"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

@test "list ranks blocked > done > working > idle and hides pane_id in field 1" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state blocked
  tx new-window -t s
  p3=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p3" @agent_state idle
  tx new-window -t s
  p4=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p4" @agent_state done
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  order=$(printf '%s\n' "$output" | cut -f1 | tr '\n' ' ')
  [ "$order" = "$p2 $p4 $p1 $p3 " ]
}

@test "list excludes panes without agent state" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx split-window -t s # second pane, no agent state
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 1 ]
  [ "$(printf '%s\n' "$output" | cut -f1)" = "$p1" ]
}

@test "list emits the catppuccin truecolour glyph" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state blocked
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"38;2;243;139;168"* ]]
}

@test "pick with no agents prints a notice and exits 0" {
  run sh "$SCRIPT" pick
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active agents"* ]]
}

@test "jump moves the active pane, tolerating a headless no-client" {
  tx split-window -t s
  set -- $(tx list-panes -t s -F '#{pane_id}')
  p1=$1
  p2=$2
  tx select-pane -t "$p1"
  [ "$(tx display-message -p -t s '#{pane_id}')" = "$p1" ]
  run sh "$SCRIPT" jump "$p2"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p -t s '#{pane_id}')" = "$p2" ]
}

@test "jump ages a done pane to idle and updates the window dot" {
  tx new-window -t s # window 2 active; window 1 inactive
  win1=$(tx list-windows -t s -F '#{window_id}' | head -n1)
  p1=$(tx list-panes -t "$win1" -F '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state done
  tx set-option -w -t "$win1" @win_agent_state done
  run sh "$SCRIPT" jump "$p1"
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = idle ]
  [ "$(tx show-options -wqv -t "$win1" @win_agent_state)" = idle ]
}

@test "jump with no pane id exits 2" {
  run sh "$SCRIPT" jump
  [ "$status" -eq 2 ]
}
