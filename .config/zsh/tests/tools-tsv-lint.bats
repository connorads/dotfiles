#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# tmux-bind-lint precedent: no setup_test_home. The positive case asserts the
# REAL tracked tools.tsv is well-formed, so it runs against the real $HOME; the
# failure cases cd into $BATS_TEST_TMPDIR and shadow a fixture tools.tsv via
# the checker's cwd-relative resolve.
CHECK="$HOME/.hk-hooks/tools-tsv-lint.sh"

@test "real tools.tsv is well-formed today" {
  cd "$HOME"
  run bash "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a tab-less row blocks and names the line" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  printf 'Good: tool\tgood-cmd\nBroken row without a tab\n' >.config/tmux/tools.tsv
  run bash "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *":2:"* ]] || false
  [[ "$output" == *"Broken row without a tab"* ]]
}

@test "embedded tabs in the command are legal" {
  # The popup parser keeps everything after the FIRST tab, so a command
  # containing tabs is fine - assert >= 2 fields, never == 2.
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  printf 'Label\tawk -F"\t" script\n' >.config/tmux/tools.tsv
  run bash "$CHECK"
  [ "$status" -eq 0 ]
}

@test "blank lines are ignored" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  printf 'Label\tcmd\n\n \nOther\tcmd2\n' >.config/tmux/tools.tsv
  run bash "$CHECK"
  [ "$status" -eq 0 ]
}
