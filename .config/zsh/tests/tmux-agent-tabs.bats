#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# Exercises the agent-tracking wiring in the REAL tmux.conf (the @agent_dotfmt
# state→glyph mapping and the seen-demotion hooks) against a throwaway tmux
# server, so a future conf edit that breaks them fails `mise run zsh-tests`.
CONF="$HOME/.config/tmux/tmux.conf"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agenttabs_${BATS_TEST_NUMBER}_$$"
  tx new-session -d -s s -x 120 -y 12
  conf="$BATS_TEST_TMPDIR/agent.conf"
  # Isolate the agent-tracking additions: the dot mapping and the `-ga` seen
  # appends. The base `-g ... refresh-client -S` hooks are unrelated and error
  # headlessly ("no current client"), so they are deliberately excluded.
  grep -E '^set -g @agent_dotfmt |^set-hook -ga (after-select-pane|session-window-changed) ' "$CONF" >"$conf"
  tx source-file "$conf"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

dot() { tx list-windows -t s -F '#{E:@agent_dotfmt}'; }

@test "blocked maps to a red filled dot" {
  tx set-option -w -t s @win_agent_state blocked
  [[ "$(dot)" == *"#[fg=#f38ba8]●"* ]]
}

@test "working maps to a yellow filled dot" {
  tx set-option -w -t s @win_agent_state working
  [[ "$(dot)" == *"#[fg=#f9e2af]●"* ]]
}

@test "done maps to a blue filled dot" {
  tx set-option -w -t s @win_agent_state done
  [[ "$(dot)" == *"#[fg=#89b4fa]●"* ]]
}

@test "idle maps to a green hollow dot" {
  tx set-option -w -t s @win_agent_state idle
  [[ "$(dot)" == *"#[fg=#a6e3a1]○"* ]]
}

@test "no agent state renders nothing" {
  tx set-option -wu -t s @win_agent_state
  [ -z "$(dot)" ]
}

# The navigation commands below return non-zero headlessly (tmux's hook dispatch
# emits "no current client" with no client attached); the demotion side-effect
# still happens, so we assert the resulting state, not the command's exit code.
@test "after-select-pane ages a done pane to idle" {
  tx split-window -t s
  set -- $(tx list-panes -t s -F '#{pane_id}')
  p1=$1
  p2=$2
  tx set-option -p -t "$p1" @agent_state done
  tx select-pane -t "$p2" || true
  tx select-pane -t "$p1" || true
  sleep 0.3
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = idle ]
}

@test "session-window-changed ages a done pane to idle" {
  w1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$w1" @agent_state done
  tx new-window -t s
  tx select-window -t "$(tx display-message -p -t "$w1" '#{window_id}')" || true
  sleep 0.3
  [ "$(tx show-options -pqv -t "$w1" @agent_state)" = idle ]
}
