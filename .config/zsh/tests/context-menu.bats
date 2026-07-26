#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

CTX="$BATS_TEST_DIRNAME/../../tmux/scripts/context-menu.sh"

setup() {
  setup_test_home
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "display-message" ]; then
  case "$*" in
    *window_panes*) printf '$1\ts\t@7\t%%5\t2\t2\t/dev/ttys010\tzsh\t/tmp/somewhere\n' ;;
    *window_linked*) printf '$1\ts\t@7\t1\tmywin\t0\t1\t2\n' ;;
  esac
elif [ "$1" = "list-panes" ]; then
  :
fi
EOF
}

@test "pane menu delegates to organiser" {
  run "$CTX" pane "%5" 10 2

  [ "$status" -eq 0 ]
  grep -q 'display-menu .* -t %5 -x 10 -y 2' "$TEST_LOG"
  grep -q 'Break and follow' "$TEST_LOG"
}

@test "window menu delegates to organiser" {
  run "$CTX" window "@7" "%5" "/tmp/somewhere" 12 0

  [ "$status" -eq 0 ]
  grep -q 'display-menu .* -t %5 -x 12 -y 0' "$TEST_LOG"
  grep -q 'Move and follow' "$TEST_LOG"
}

@test "session menu delegates to organiser" {
  run "$CTX" session 7 0

  [ "$status" -eq 0 ]
  grep -q 'display-menu .* -x 7 -y 0' "$TEST_LOG"
  grep -q 'Organise window' "$TEST_LOG"
}

@test "wt-finish popup mode kills the window only on success" {
  write_stub wt-finish <<'EOF'
#!/usr/bin/env bash
printf 'wt-finish %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-finish "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-finish --mode local /tmp/trees/repo/topic" "$TEST_LOG"
  grep -q -- "kill-window -t @7" "$TEST_LOG"
}

@test "wt-finish popup mode leaves the window open on failure" {
  write_stub wt-finish <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run --separate-stderr "$CTX" wt-finish "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"window left open"* ]]
  ! grep -q "kill-window" "$TEST_LOG"
}

@test "wt-remove popup mode kills the window only on success" {
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-remove "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-remove /tmp/trees/repo/topic" "$TEST_LOG"
  grep -q -- "kill-window -t @7" "$TEST_LOG"
}

@test "wt-remove popup mode leaves the window open on failure" {
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run --separate-stderr "$CTX" wt-remove "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"window left open"* ]]
  ! grep -q "kill-window" "$TEST_LOG"
}

@test "wt-publish popup mode publishes without touching the window" {
  write_stub wt-publish <<'EOF'
#!/usr/bin/env bash
printf 'wt-publish %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-publish "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-publish --pr /tmp/trees/repo/topic" "$TEST_LOG"
  ! grep -q "kill-window" "$TEST_LOG"
}

@test "unknown subcommand fails with usage" {
  run --separate-stderr "$CTX" bogus

  [ "$status" -eq 1 ]
  [[ "$stderr" == *"usage:"* ]]
}

@test "legacy menu modes are rejected" {
  for mode in pane-legacy window-legacy session-legacy; do
    run --separate-stderr "$CTX" "$mode"
    [ "$status" -eq 1 ]
    [[ "$stderr" == *"usage:"* ]]
  done
}
