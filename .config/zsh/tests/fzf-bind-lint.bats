#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# tmux-bind-lint.bats precedent: no setup_test_home. The positive case asserts
# the REAL tracked fzf calls are collision-free, so it runs against the real
# $HOME; the failure cases cd into $BATS_TEST_TMPDIR and shadow a fixture file
# under one scanned root via the checker's cwd-relative resolve.
CHECK="$HOME/.hk-hooks/fzf-bind-lint.py"

@test "real fzf invocations are collision-free today" {
  cd "$HOME"
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "ctrl-i + tab in one fzf invocation blocks and names both keys" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p src/skl/bin
  cat >src/skl/bin/pick <<'EOF'
out=$(skl list \
  | fzf --reverse --multi \
      --bind 'tab:toggle+down,btab:toggle+up' \
      --expect 'ctrl-y,ctrl-i')
EOF
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"fzf-bind-lint"* ]]
  [[ "$output" == *"ctrl-i"* ]]
  [[ "$output" == *"tab"* ]]
  [[ "$output" == *"same physical key"* ]]
}

@test "the patched alt-i form passes (no alias collision)" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p src/skl/bin
  cat >src/skl/bin/pick <<'EOF'
out=$(skl list \
  | fzf --reverse --multi \
      --bind 'tab:toggle+down,btab:toggle+up' \
      --expect 'ctrl-y,alt-i')
EOF
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "enter alone (no ctrl-m) is legitimate and passes" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/zsh/functions
  cat >.config/zsh/functions/picker <<'EOF'
fzf --bind 'enter:accept,tab:toggle' --expect 'ctrl-y'
EOF
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
}

@test "ctrl-m + enter collision blocks" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux/scripts
  cat >.config/tmux/scripts/picker.sh <<'EOF'
fzf --bind 'enter:accept' --expect 'ctrl-m'
EOF
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"ctrl-m"* ]]
  [[ "$output" == *"enter"* ]]
}
