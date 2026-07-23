#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# quarantine-drift precedent: no setup_test_home. The positive case asserts the
# REAL tracked tmux.conf is collision-free, so it runs against the real $HOME;
# the failure cases cd into $BATS_TEST_TMPDIR and shadow a fixture tmux.conf via
# the checker's cwd-relative resolve.
CHECK="$HOME/.hk-hooks/tmux-bind-lint.py"

@test "real tmux.conf is collision-free today" {
  cd "$HOME"
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "a duplicate bind blocks and names key, table, and both lines" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  cat >.config/tmux/tmux.conf <<'EOF'
bind -N "Next window" n next-window
bind -N "dup" n other-cmd
EOF
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"duplicate"* ]]
  [[ "$output" == *"'n'"* ]]
  [[ "$output" == *"prefix"* ]]
  [[ "$output" == *"1"* ]]
  [[ "$output" == *"2"* ]]
}

@test "same key in different tables passes (cross-table is legitimate)" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  cat >.config/tmux/tmux.conf <<'EOF'
bind -n C-l send-keys 'C-l'
bind -T copy-mode-vi C-l select-pane -R
EOF
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
}

@test "an alias collision (Tab + C-i, same table) blocks" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  cat >.config/tmux/tmux.conf <<'EOF'
bind -N "Last window" Tab last-window
bind -N "Next window" C-i next-window
EOF
  run python3 "$CHECK"
  [ "$status" -eq 1 ]
  [[ "$output" == *"alias collision"* ]]
}

@test "Tab + C-i in different tables passes (no shared byte across tables)" {
  cd "$BATS_TEST_TMPDIR"
  mkdir -p .config/tmux
  cat >.config/tmux/tmux.conf <<'EOF'
bind Tab last-window
bind -n C-i next-window
EOF
  run python3 "$CHECK"
  [ "$status" -eq 0 ]
}
