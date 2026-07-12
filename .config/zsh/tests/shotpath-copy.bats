#!/usr/bin/env bats
# Behaviour of the tmux shotpath wrappers: shotpath-copy.sh (prefix + Alt+i,
# fire-and-forget local) and shotpath-remote-popup.sh (prefix + Alt+I, popup).
# shotpath and tmux are stubbed; assertions are on the set-buffer/paste-buffer
# calls, display-message calls, exit status, and whether the popup pauses.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

COPY_SCRIPT="$BATS_TEST_DIRNAME/../../tmux/scripts/shotpath-copy.sh"
REMOTE_SCRIPT="$BATS_TEST_DIRNAME/../../tmux/scripts/shotpath-remote-popup.sh"

setup() {
  setup_test_home
  # tmux stub: logs every call; answers `display-message -p` with a pane id
  # (%7) so the remote script can self-resolve its origin; fails paste-buffer
  # when TMUX_STUB_FAIL_PASTE=1 to exercise the copied-only fallback.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$TEST_LOG"
if [ "${1:-}" = "display-message" ] && [ "${2:-}" = "-p" ]; then
  echo "%7"
fi
if [ "${1:-}" = "paste-buffer" ] && [ "${TMUX_STUB_FAIL_PASTE:-0}" = "1" ]; then
  exit 1
fi
EOF
}

@test "shotpath-copy with pane arg pastes into the pane and reports pasted" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/shotpath-123.png"
echo "Copied local path to clipboard" >&2
EOF

  run "$COPY_SCRIPT" "%1"

  [ "$status" -eq 0 ]
  grep -F "tmux set-buffer -b shotpath -- /tmp/screenshots/shotpath-123.png" "$TEST_LOG"
  grep -F "tmux paste-buffer -p -d -b shotpath -t %1" "$TEST_LOG"
  grep -F "tmux display-message -d 2000 shotpath ✓ pasted shotpath-123.png" "$TEST_LOG"
}

@test "shotpath-copy pastes a local GIF path into the originating pane" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/shotpath-123.gif"
EOF

  run "$COPY_SCRIPT" "%3"

  [ "$status" -eq 0 ]
  grep -F "tmux set-buffer -b shotpath -- /tmp/screenshots/shotpath-123.gif" "$TEST_LOG"
  grep -F "tmux paste-buffer -p -d -b shotpath -t %3" "$TEST_LOG"
  grep -F "tmux display-message -d 2000 shotpath ✓ pasted shotpath-123.gif" "$TEST_LOG"
}

@test "shotpath-copy without pane arg skips paste and reports copied" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/shotpath-123.png"
echo "Copied local path to clipboard" >&2
EOF

  run "$COPY_SCRIPT"

  [ "$status" -eq 0 ]
  ! grep -q "set-buffer" "$TEST_LOG"
  ! grep -q "paste-buffer" "$TEST_LOG"
  grep -F "tmux display-message -d 2000 shotpath ✓ copied shotpath-123.png" "$TEST_LOG"
}

@test "shotpath-copy falls back to copied when the paste fails" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/shotpath-123.png"
EOF
  export TMUX_STUB_FAIL_PASTE=1

  run "$COPY_SCRIPT" "%1"

  [ "$status" -eq 0 ]
  grep -F "tmux display-message -d 2000 shotpath ✓ copied shotpath-123.png" "$TEST_LOG"
  ! grep -q "✓ pasted" "$TEST_LOG"
}

@test "shotpath-copy failure surfaces stderr text, no paste, still exits 0" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "shotpath: no image in clipboard" >&2
exit 1
EOF

  run "$COPY_SCRIPT" "%1"

  [ "$status" -eq 0 ]
  ! grep -q "set-buffer" "$TEST_LOG"
  ! grep -q "paste-buffer" "$TEST_LOG"
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

@test "shotpath-remote-popup success pastes into the origin pane" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/sendshot-123.png"
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  [[ "$output" != *"Press any key"* ]]
  grep -F "tmux display-message -p #{pane_id}" "$TEST_LOG"
  grep -F "tmux set-buffer -b shotpath -- /tmp/screenshots/sendshot-123.png" "$TEST_LOG"
  grep -F "tmux paste-buffer -p -d -b shotpath -t %7" "$TEST_LOG"
  grep -F "tmux display-message -d 3000 shotpath ✓ pasted /tmp/screenshots/sendshot-123.png" "$TEST_LOG"
}

@test "shotpath-remote-popup pastes an uploaded GIF path into the originating pane" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/sendshot-123.gif"
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  grep -F "tmux set-buffer -b shotpath -- /tmp/screenshots/sendshot-123.gif" "$TEST_LOG"
  grep -F "tmux paste-buffer -p -d -b shotpath -t %7" "$TEST_LOG"
  grep -F "tmux display-message -d 3000 shotpath ✓ pasted /tmp/screenshots/sendshot-123.gif" "$TEST_LOG"
}

@test "shotpath-remote-popup falls back to copied when the paste fails" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "/tmp/screenshots/sendshot-123.png"
EOF
  export TMUX_STUB_FAIL_PASTE=1

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  grep -F "tmux display-message -d 3000 shotpath ✓ copied /tmp/screenshots/sendshot-123.png" "$TEST_LOG"
  ! grep -q "✓ pasted" "$TEST_LOG"
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
  ! grep -q "display-message -d" "$TEST_LOG"
  ! grep -q "paste-buffer" "$TEST_LOG"
}

@test "shotpath-remote-popup streams authentication prompts while shotpath is running" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
echo "Tailscale SSH authentication required" >&2
sleep 2
exit 1
EOF
  local output_file="$BATS_TEST_TMPDIR/popup-output"

  "$REMOTE_SCRIPT" </dev/null >"$output_file" 2>&1 &
  local popup_pid=$!

  local visible=0
  for _ in {1..50}; do
    if grep -q "Tailscale SSH authentication required" "$output_file"; then
      visible=1
      break
    fi
    sleep 0.02
  done
  [ "$visible" -eq 1 ]
  kill -0 "$popup_pid"
  wait "$popup_pid"
  [ "$(grep -c "Tailscale SSH authentication required" "$output_file")" -eq 1 ]
}

@test "shotpath-remote-popup silent cancel (fzf Esc) closes without pause" {
  write_stub shotpath <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REMOTE_SCRIPT" </dev/null

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  ! grep -q "display-message -d" "$TEST_LOG"
  ! grep -q "paste-buffer" "$TEST_LOG"
}
