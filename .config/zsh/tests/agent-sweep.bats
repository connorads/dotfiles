#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-sweep.sh"
SHELLS=" zsh bash sh fish dash ash "

# All assertions run against a throwaway private tmux server (real infrastructure)
# so the sweep's list-panes read and rollup are computed by tmux exactly as in
# production. Bare `tmux` (as the script invokes it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentsweep_${BATS_TEST_NUMBER}_$$"
  tx new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  if [ -n "${DAEMON_PID:-}" ]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    kill -- -"$DAEMON_PID" 2>/dev/null || true
  fi
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

pstate() { tx show-options -pqv -t "$1" @agent_state; }
wstate() { tx show-options -wqv -t "$1" @win_agent_state; }

# Wait until a pane's foreground command is no longer a bare shell (the agent's
# child has taken over), or give up after ~3s.
wait_nonshell() {
  local pane=$1 cmd i
  for i in $(seq 1 15); do
    cmd=$(tx display-message -p -t "$pane" '#{pane_current_command}')
    case "$SHELLS" in *" $cmd "*) sleep 0.2 ;; *) return 0 ;; esac
  done
  return 0
}

@test "sweep clears a stale dot on a shell-foreground pane" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx set-option -p -t "$pane" @agent_state working
  tx set-option -p -t "$pane" @agent_kind claude
  tx set-option -w -t "$win" @win_agent_state working
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$(pstate "$pane")" ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_kind)" ]
  [ -z "$(wstate "$win")" ]
}

@test "sweep leaves a non-shell foreground pane untouched" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx send-keys -t "$pane" 'sleep 300' Enter
  wait_nonshell "$pane"
  tx set-option -p -t "$pane" @agent_state working
  tx set-option -w -t "$win" @win_agent_state working
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
  [ "$(wstate "$win")" = working ]
}

@test "sweep recomputes the window dot down when the worst pane was hard-closed" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx send-keys -t "$p1" 'sleep 300' Enter
  wait_nonshell "$p1"
  tx split-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p2" @agent_state blocked
  tx set-option -w -t "$win" @win_agent_state blocked
  tx kill-pane -t "$p2" # worst pane gone; rollup now stale at blocked
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = working ]
  [ "$(wstate "$win")" = working ]
}

@test "sweep is a quiet no-op when nothing is stale" {
  win=$(tx display-message -p -t s '#{window_id}')
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$(wstate "$win")" ]
}

@test "sweep is a quiet no-op when the server is gone" {
  tx kill-server 2>/dev/null || true
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
