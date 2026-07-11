#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

FLT="$TESTS_DIR/../functions/tmux/flt"

# Pure assertions run against --print (no server); the one real-server test is
# integration-tagged and guards on new-pane support (tmux 3.7+).

@test "default is a centred 70% float in the caller's cwd" {
  run -0 zsh --no-rcs "$FLT" --print
  [ "$output" = "tmux new-pane -x 70% -y 70% -X 15% -Y 15% -c $PWD" ]
}

@test "tr preset is thin, flush right, inset below the top status row" {
  run -0 zsh --no-rcs "$FLT" --print tr
  [[ "$output" == *"-x 25% -y 35% -X 75% -Y 5%"* ]]
}

@test "corner presets: bottom flush (Y+h = 100%), top inset 5%" {
  run -0 zsh --no-rcs "$FLT" --print br
  [[ "$output" == *"-X 75% -Y 65%"* ]]
  run -0 zsh --no-rcs "$FLT" --print bl
  [[ "$output" == *"-X 0% -Y 65%"* ]]
  run -0 zsh --no-rcs "$FLT" --print tl
  [[ "$output" == *"-X 0% -Y 5%"* ]]
}

@test "a non-preset first arg is the command, centred by default" {
  run -0 zsh --no-rcs "$FLT" --print btm
  [[ "$output" == *"-x 70% -y 70%"* ]]
  [[ "$output" == *" -- btm" ]]
}

@test "preset plus command combine" {
  run -0 zsh --no-rcs "$FLT" --print tr btm --basic
  [[ "$output" == *"-X 75% -Y 5%"* ]]
  [[ "$output" == *" -- btm --basic" ]]
}

@test "-d spawns without focus and -c overrides the directory" {
  run -0 zsh --no-rcs "$FLT" --print -d -c /tmp big
  [[ "$output" == *"-x 90% -y 85%"* ]]
  [[ "$output" == *"-c /tmp -d"* ]]
}

@test "unknown option exits 2 with usage" {
  run zsh --no-rcs "$FLT" --print --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage: flt"* ]]
}

@test "-c without a directory exits 2" {
  run zsh --no-rcs "$FLT" --print -c
  [ "$status" -eq 2 ]
}

@test "outside tmux it refuses instead of hitting the default socket" {
  TMUX= run zsh --no-rcs "$FLT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not inside tmux"* ]]
}

# bats test_tags=integration
@test "creates a real floating pane on a private server" {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="flt_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24 'exec sleep 60'
  tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }
  tx list-commands | grep -q '^new-pane' || {
    tx kill-server
    skip "no floating-pane support in this tmux"
  }
  TMUX="$(tx display -p '#{socket_path}'),$(tx display -p '#{pid}'),0"
  run -0 env TMUX="$TMUX" zsh --no-rcs "$FLT" tr 'sleep 60'
  run -0 tx list-panes -F '#{pane_floating_flag} #{pane_left},#{pane_top}'
  [[ "$output" == *"1 60,1"* ]] # 25% of 80 = 20 wide flush right at 60; 5% top inset = row 1
  tx kill-server 2>/dev/null || true
}
