#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-branch-menu.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions"
  export CLAUDE_SESSION_RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"
  # tmux stub records every invocation so we can assert what was shown.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

# ps stub: a live foreground claude (pid 711) on ttys010.
stub_ps_with_foreground_claude() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    ;;
  *) exit 1 ;;
esac
EOF
}

@test "no foreground claude -> 'No Claude in this pane'" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "No Claude in this pane" "$TEST_LOG"
  ! grep -q "display-menu" "$TEST_LOG"
}

@test "claude running but no registry file -> not-forkable message names the pid" {
  stub_ps_with_foreground_claude

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "pid 711" "$TEST_LOG"
  grep -q "not forkable" "$TEST_LOG"
  # it must not fall back to the ambiguous "no Claude" message...
  ! grep -q "No Claude in this pane" "$TEST_LOG"
  # ...and there is nothing to fork, so no menu.
  ! grep -q "display-menu" "$TEST_LOG"
}

@test "claude with no registry but resumable launch args -> opens the branch menu" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    ;;
  *"-o command= -p 711"*)
    printf 'claude --resume session-from-args\n'
    ;;
  *) exit 1 ;;
esac
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q "session-from-args" "$TEST_LOG"
  ! grep -q "not registered" "$TEST_LOG"
  ! grep -q "\\[resolved\\]" "$TEST_LOG"
}

@test "claude with a registry file -> opens the branch menu, no error message" {
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q "session-xyz" "$TEST_LOG"
  ! grep -q "not registered" "$TEST_LOG"
  ! grep -q "No Claude in this pane" "$TEST_LOG"
}
