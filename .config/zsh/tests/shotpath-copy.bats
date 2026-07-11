#!/usr/bin/env bats
# Behaviour of the tmux shotpath wrappers: shotpath-copy.sh (prefix + Alt+i,
# fire-and-forget local) and shotpath-remote-popup.sh (prefix + Alt+I, popup).
# shotpath and tmux are stubbed; assertions are on the display-message calls,
# exit status, and whether the popup pauses.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

COPY_SCRIPT="$BATS_TEST_DIRNAME/../../tmux/scripts/shotpath-copy.sh"
REMOTE_SCRIPT="$BATS_TEST_DIRNAME/../../tmux/scripts/shotpath-remote-popup.sh"

setup() {
  setup_test_home
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$TEST_LOG"
EOF
}

@test "shotpath-copy success reports basename on the status line" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/shotpath-123.png"
echo "Copied local path to clipboard" >&2
EOF

  run "$COPY_SCRIPT"

  [ "$status" -eq 0 ]
  grep -F "tmux display-message -d 2000 shotpath ✓ copied shotpath-123.png" "$TEST_LOG"
}

@test "shotpath-copy failure surfaces stderr text and still exits 0" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "shotpath: no image in clipboard" >&2
exit 1
EOF

  run "$COPY_SCRIPT"

  [ "$status" -eq 0 ]
  grep -F "tmux display-message -d 4000 shotpath ✗ no image in clipboard" "$TEST_LOG"
}

@test "shotpath-copy failure with no stderr still shows a failure message" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$COPY_SCRIPT"

  [ "$status" -eq 0 ]
  grep -F "tmux display-message -d 4000 shotpath ✗ failed" "$TEST_LOG"
}

@test "shotpath-remote-popup success exits 0 and reports the remote path" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/sendshot-123.png"
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  [[ "$output" != *"Press any key"* ]]
  grep -F "tmux display-message -d 3000 shotpath ✓ copied /tmp/screenshots/sendshot-123.png" "$TEST_LOG"
}

@test "shotpath-remote-popup failure with error text pauses to show it" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "shotpath: host required for --remote (or set SENDSHOT_HOST)" >&2
exit 1
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  [[ "$output" == *"host required for --remote"* ]]
  [[ "$output" == *"Press any key"* ]]
  ! grep -q "display-message" "$TEST_LOG"
}

@test "shotpath-remote-popup silent cancel (fzf Esc) closes without pause" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  ! grep -q "display-message" "$TEST_LOG"
}
