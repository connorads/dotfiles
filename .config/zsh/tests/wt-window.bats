#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_WINDOW="$BATS_TEST_DIRNAME/../../tmux/scripts/wt-window.sh"

setup() {
  setup_test_home
  # tmux stub: logs every invocation; answers list-panes from $TMUX_PANES.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "list-panes" ]; then
  printf '%s\n' "${TMUX_PANES:-}"
fi
EOF
}

@test "open focuses the window whose pane cwd is the worktree path" {
  export TMUX_PANES=$'@1\t/tmp/elsewhere\n@2\t/tmp/trees/repo/foo'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q "switch-client -t @2" "$TEST_LOG"
  grep -q "select-window -t @2" "$TEST_LOG"
  ! grep -q "new-window" "$TEST_LOG"
}

@test "open focuses a window whose pane cwd is inside the worktree" {
  export TMUX_PANES=$'@3\t/tmp/trees/repo/foo/src/deep'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q "switch-client -t @3" "$TEST_LOG"
}

@test "open creates a new window when nothing matches" {
  export TMUX_PANES=$'@1\t/tmp/elsewhere'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q -- "new-window -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "switch-client" "$TEST_LOG"
}

@test "open matches on path boundaries, not bare prefixes" {
  # A pane in repo/foobar must NOT satisfy repo/foo.
  export TMUX_PANES=$'@4\t/tmp/trees/repo/foobar'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q -- "new-window -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "switch-client" "$TEST_LOG"
}

@test "new runs wt-add and opens a window in the printed path" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
printf 'wt-add %s\n' "$*" >>"$TEST_LOG"
echo "/tmp/trees/repo/feat/x"
EOF

  run "$WT_WINDOW" new "feat/x"

  [ "$status" -eq 0 ]
  grep -q "wt-add feat/x" "$TEST_LOG"
  grep -q -- "new-window -c /tmp/trees/repo/feat/x" "$TEST_LOG"
}

@test "new outside a git repository soft-fails without opening a window" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$WT_WINDOW" new "feat/x" </dev/null

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  ! grep -q "new-window" "$TEST_LOG"
}

@test "new rejects branch names with spaces" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run --separate-stderr "$WT_WINDOW" new "feat x" </dev/null

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"must not contain spaces"* ]]
  ! grep -q "new-window" "$TEST_LOG"
}
