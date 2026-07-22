#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

FLAGS="$FUNCTIONS_DIR/claude-launch-flags"

setup() {
  setup_test_home
}

@test "default emits only the system-prompt append" {
  run_zsh_function "$FLAGS"

  [ "$status" -eq 0 ]
  [ "$output" = "--append-system-prompt-file $HOME/.claude/system-append.md" ]
}

@test "--yolo adds skip-permissions after the append" {
  run_zsh_function "$FLAGS" --yolo

  [ "$status" -eq 0 ]
  [ "$output" = "--append-system-prompt-file $HOME/.claude/system-append.md --dangerously-skip-permissions" ]
}

@test "-y is a synonym for --yolo" {
  run_zsh_function "$FLAGS" -y

  [ "$status" -eq 0 ]
  [ "$output" = "--append-system-prompt-file $HOME/.claude/system-append.md --dangerously-skip-permissions" ]
}

@test "the append path is expanded from the caller's HOME" {
  run_zsh_function "$FLAGS"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.claude/system-append.md" ]]
  # No literal, unexpanded $HOME leaks through.
  [[ "$output" != *'$HOME'* ]]
}
