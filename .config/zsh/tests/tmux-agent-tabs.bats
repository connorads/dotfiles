#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# Exercises the tab/agent wiring in the REAL tmux.conf (window label formats,
# the @agent_dotfmt state→glyph mapping, and the seen-demotion hooks) against a throwaway tmux
# server, so a future conf edit that breaks them fails `mise run zsh-tests`.
CONF="$HOME/.config/tmux/tmux.conf"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agenttabs_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: start bare, then source ONLY the curated agent.conf below. Without
  # it the server would also load the whole real tmux.conf, defeating the isolation
  # this test exists for (the unrelated base hooks the next comment says it excludes).
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 120 -y 12
  conf="$BATS_TEST_TMPDIR/agent.conf"
  # Isolate the tab additions: label formats, dot mapping and the `-ga` seen
  # appends. The base `-g ... refresh-client -S` hooks are unrelated and error
  # headlessly ("no current client"), so they are deliberately excluded.
  grep -E '^set -g @agent_dotfmt |^set -g window-status(-current)?-format |^set-hook -ga (after-select-pane|session-window-changed|client-focus-in) ' "$CONF" >"$conf"
  tx source-file "$conf"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

dot() { tx list-windows -t s -F '#{E:@agent_dotfmt}'; }

assert_tab_label() {
  local target=$1
  local expected=$2
  local unexpected=$3
  local option rendered

  for option in window-status-format window-status-current-format; do
    rendered="$(tx display-message -p -t "$target" "#{T:$option}")"
    [[ "$rendered" == *"$expected"* ]]
    [[ "$rendered" != *"$unexpected"* ]]
  done
}

@test "blocked maps to a red diamond" {
  tx set-option -w -t s @win_agent_state blocked
  [[ "$(dot)" == *"#[fg=#f38ba8]◆"* ]]
}

@test "working is a peach half-dot (clears the yellow active-tab text)" {
  tx set-option -w -t s @win_agent_state working # sole window is active
  [[ "$(dot)" == *"#[fg=#fab387]◐"* ]]
}

@test "working stays peach on an unfocused tab (one colour per state)" {
  tx set-option -w -t s @win_agent_state working # window 1, currently active
  tx new-window -t s                             # window 2 active; window 1 inactive
  [[ "$(dot)" == *"#[fg=#fab387]◐"* ]]
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

@test "automatic window tab labels render cwd basename" {
  dir="$BATS_TEST_TMPDIR/auto-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"

  assert_tab_label "$win" "auto-project" "zsh"
}

@test "manual window tab labels render the window name" {
  dir="$BATS_TEST_TMPDIR/cwd-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"
  tx rename-window -t "$win" "manual-name"

  assert_tab_label "$win" "manual-name" "cwd-project"
}

@test "resetting automatic-rename returns tab labels to cwd basename" {
  dir="$BATS_TEST_TMPDIR/cwd-project"
  mkdir -p "$dir"
  win="$(tx new-window -d -P -F '#{window_id}' -t s -c "$dir")"
  tx rename-window -t "$win" "manual-name"
  tx set-window-option -t "$win" automatic-rename on

  assert_tab_label "$win" "cwd-project" "manual-name"
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

# client-focus-in fires on a real terminal focus event, which cannot be driven
# headlessly, so assert tmux actually REGISTERED the hook bound to `seen`. This
# guards the tmux 3.7b trap: `pane-focus-in` is accepted but never stored as a
# global hook, so reverting this to pane-focus-in would silently stop ageing a
# `done` pane you regain focus on without navigating.
@test "client-focus-in is registered to age panes via seen" {
  line="$(tx show-hooks -g | grep client-focus-in || true)"
  [ -n "$line" ]
  [[ "$line" == *"agent-state.sh seen"* ]]
}
