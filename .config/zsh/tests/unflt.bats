#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

UNFLT="$TESTS_DIR/../functions/tmux/unflt"

# Unlike flt, --print cannot be asserted without a server: the command it builds
# names a target pane and a destination pane, and both are answers only tmux can
# give. So most tests run against a bare private server, which costs ~1s and is
# not on its own grounds for the integration tag (see AGENTS.md); only the test
# that really moves a pane carries it.

teardown() { stop_private_server; }

tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

# A private server with one tiled pane (%0), and TMUX pointing at it. Sets SOCK
# and TMUX_BIN, which tx and teardown's stop_private_server key on.
start_server() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="unflt_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24 'exec sleep 60'
  tx list-commands | grep -q '^new-pane' || skip "no floating-pane support in this tmux"
  TMUX="$(tx display -p '#{socket_path}'),$(tx display -p '#{pid}'),0"
}

# A focused float in the private server's only window.
float() { tx new-pane -x 25% -y 35% -X 75% -Y 5% 'exec sleep 60'; }

@test "default: joins the active float beside the window's tiled pane" {
  start_server
  float
  run -0 env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print
  [ "$output" = "tmux join-pane -h -s %1 -t %0" ]
}

@test "-v joins below instead of beside" {
  start_server
  float
  run -0 env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print -v
  [ "$output" = "tmux join-pane -v -s %1 -t %0" ]
}

@test "an explicit target overrides the active pane" {
  start_server
  float # %1
  float # %2, now the active one
  run -0 env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print %1
  [ "$output" = "tmux join-pane -h -s %1 -t %0" ]
}

@test "with two floats the destination is still a tiled pane (the -t :.+ trap)" {
  start_server
  float                # %1
  float                # %2
  tx select-pane -t %1 # so the *next* pane is the other float
  run -0 env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print
  # -t :.+ would resolve to %2 here and fail with "size or position can't split
  # a floating pane"; the destination has to be filtered to a non-floating pane.
  [ "$output" = "tmux join-pane -h -s %1 -t %0" ]
}

@test "refuses a target that is not floating" {
  start_server
  float
  run env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print %0
  [ "$status" -eq 1 ]
  [ -z "$output" ] # the refusal goes to display-message, not stdout
}

@test "refuses a pane that does not exist" {
  start_server
  run env TMUX="$TMUX" zsh --no-rcs "$UNFLT" --print %99
  [ "$status" -eq 1 ]
}

@test "outside tmux it refuses instead of hitting the default socket" {
  TMUX= run zsh --no-rcs "$UNFLT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not inside tmux"* ]]
}

@test "unknown option exits 2 with usage" {
  TMUX= run zsh --no-rcs "$UNFLT" --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage: unflt"* ]]
}

# bats test_tags=integration
@test "a real float rejoins the layout, focused, with its process alive" {
  start_server
  float # %1
  float # %2, so the join happens with another float present
  run -0 env TMUX="$TMUX" zsh --no-rcs "$UNFLT" %1
  run -0 tx display -p -t %1 '#{pane_floating_flag} #{pane_dead} #{pane_active}'
  [ "$output" = "0 0 1" ]
}
