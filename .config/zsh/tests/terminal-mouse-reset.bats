#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

COMMAND="$FUNCTIONS_DIR/shell/terminal-mouse-reset"
EXPECTED=$'\033[?9l\033[?1000l\033[?1001l\033[?1002l\033[?1003l\033[?1005l\033[?1006l\033[?1015l\033[?1016l'

setup() {
  setup_test_home
  TMUX_SOCKET="terminal-mouse-reset-${BATS_TEST_NUMBER}-$$"
}

teardown() {
  tmux -L "$TMUX_SOCKET" kill-server 2>/dev/null || true
}

@test "prints the xterm mouse-mode reset sequence" {
  run "$COMMAND"

  [ "$status" -eq 0 ]
  [ "$output" = "$EXPECTED" ]
}

@test "rejects arguments" {
  run "$COMMAND" unexpected

  [ "$status" -eq 2 ]
  [ "$output" = "usage: terminal-mouse-reset" ]
}

# bats test_tags=integration
@test "clears a pane's stale mouse mode without disabling tmux mouse support" {
  tmux -L "$TMUX_SOCKET" -f /dev/null new-session -d -s check -x 80 -y 24 'zsh -f'
  tmux -L "$TMUX_SOCKET" set-option -g mouse on

  wait_until '[ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 "#{pane_current_command}")" = zsh ]'
  tmux -L "$TMUX_SOCKET" send-keys -t check:0.0 "printf '\\033[?1003h\\033[?1006h'" Enter
  wait_until '[ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 "#{mouse_any_flag}")" = 1 ]'

  tmux -L "$TMUX_SOCKET" send-keys -t check:0.0 "$COMMAND" Enter

  wait_until '[ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 "#{mouse_any_flag}")" = 0 ]'
  [ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 '#{mouse_sgr_flag}')" -eq 0 ]
  [ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 '#{mouse_all_flag}')" -eq 0 ]
  [ "$(tmux -L "$TMUX_SOCKET" display-message -p -t check:0.0 '#{mouse}')" -eq 1 ]
}
