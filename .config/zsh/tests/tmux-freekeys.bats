#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

FN="$FUNCTIONS_DIR/tmux/tmux-freekeys"

# Throwaway private tmux server (-f /dev/null: bare, no user config, but tmux's
# compiled-in default binds are still present). The function only reads
# list-keys, so pointing $TMUX at this socket is enough. `y` is unbound
# explicitly so the "free letter" assertions hold whatever a tmux version binds
# by default; `Tab` is bound so the C-i aliasing rule has something to catch.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="tfk_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  tx bind-key -T prefix a display x
  tx bind-key -T prefix Tab display y
  tx unbind-key -T prefix y
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

@test "report: bound letter is used, unbound letter is free" {
  run zsh --no-rcs "$FN" prefix
  [ "$status" -eq 0 ]
  # The lowercase line lists a under used and y under free.
  echo "$output" | grep -E '^  used .*: .*\ba\b'
  echo "$output" | grep -E '^  FREE .*: .*\by\b'
}

@test "report: default table is prefix" {
  run zsh --no-rcs "$FN"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Key table: prefix"* ]]
}

@test "report: C-i is flagged aliased (Tab bound), not free" {
  run zsh --no-rcs "$FN" prefix
  [ "$status" -eq 0 ]
  # In the Ctrl class C-i lands in the aliased bucket, never FREE.
  echo "$output" | grep -E '^  aliased .*: .*C-i'
  ! echo "$output" | grep -E '^  FREE .*: .*C-i'
  # And the always-shown caveat block spells it out.
  echo "$output" | grep -E 'C-i .* Tab .* effectively taken'
}

@test "--all lists key-tables with bound-counts" {
  run zsh --no-rcs "$FN" --all
  [ "$status" -eq 0 ]
  echo "$output" | grep -E '^ +[0-9]+  prefix$'
  echo "$output" | grep -E '^ +[0-9]+  copy-mode$'
}

@test "check: bound key reports its mapping" {
  run zsh --no-rcs "$FN" check a prefix
  [ "$status" -eq 0 ]
  [[ "$output" == *"a is BOUND in prefix"* ]]
  [[ "$output" == *"display"* ]]
}

@test "check: unbound key is free" {
  run zsh --no-rcs "$FN" check y prefix
  [ "$status" -eq 0 ]
  [[ "$output" == "y is FREE in prefix" ]]
}

@test "check: aliasing key whose partner is bound is effectively taken" {
  run zsh --no-rcs "$FN" check C-i prefix
  [ "$status" -eq 0 ]
  [[ "$output" == *"EFFECTIVELY TAKEN"* ]]
  [[ "$output" == *"Tab"* ]]
}

@test "check: defaults to prefix table when omitted" {
  run zsh --no-rcs "$FN" check a
  [ "$status" -eq 0 ]
  [[ "$output" == *"a is BOUND in prefix"* ]]
}

@test "check with no key is a usage error" {
  run zsh --no-rcs "$FN" check
  [ "$status" -eq 2 ]
}

@test "--help exits 0" {
  run zsh --no-rcs "$FN" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage:"* ]]
}

@test "unknown option exits 2" {
  run zsh --no-rcs "$FN" --nope
  [ "$status" -eq 2 ]
}
