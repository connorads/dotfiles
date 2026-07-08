#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$BATS_TEST_DIRNAME/../../tmux/scripts/agent-branch-menu.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions" "$HOME/.codex/sessions/2026/06/24"
  export CLAUDE_SESSION_RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"
  # tmux stub records every invocation so we can assert what was shown.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

stub_lsof_codex_rollout() {
  export CODEX_ROLLOUT="$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl"
  cat >"$CODEX_ROLLOUT" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-thread","cwd":"/Users/connorads"}}
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-p\ 811*) printf 'codex 811 user 10r REG 1,2 0 1 %s\n' "$CODEX_ROLLOUT" ;;
  *) exit 1 ;;
esac
EOF
}

@test "no foreground agent -> 'No Claude or Codex in this pane'" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "No Claude or Codex in this pane" "$TEST_LOG"
  ! grep -q "display-menu" "$TEST_LOG"
}

@test "foreground claude dispatches to the Claude branch menu" {
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
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"claude-session","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "claude --dangerously-skip-permissions -r claude-session --fork-session" "$TEST_LOG"
  ! grep -q -- "codex --dangerously-bypass-approvals-and-sandbox" "$TEST_LOG"
}

@test "foreground codex dispatches to the Codex branch menu" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  800 Ss zsh\n'
    printf '  811 S+ codex\n'
    ;;
  *) exit 1 ;;
esac
EOF
  stub_lsof_codex_rollout

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "codex --dangerously-bypass-approvals-and-sandbox -C /Users/connorads fork codex-thread" "$TEST_LOG"
  ! grep -q -- "claude --dangerously-skip-permissions" "$TEST_LOG"
}

@test "claude is preferred when both agents appear foreground" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    printf '  811 S+ codex\n'
    ;;
  *) exit 1 ;;
esac
EOF
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"claude-session","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF
  stub_lsof_codex_rollout

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "claude --dangerously-skip-permissions -r claude-session --fork-session" "$TEST_LOG"
  ! grep -q -- "codex --dangerously-bypass-approvals-and-sandbox" "$TEST_LOG"
}
