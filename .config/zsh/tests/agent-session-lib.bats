#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

REAL_SESSION_LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/lib/agent-session.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions"
  # shellcheck disable=SC1090
  source "$REAL_SESSION_LIB"
}

@test "claude_session_meta_for_pid emits the live JSON and jq extracts sessionId" {
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-abc","cwd":"/Users/connorads","name":"tidy tests","status":"idle"}
EOF

  run claude_session_meta_for_pid 901
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  sid=$(printf '%s' "$output" | jq -r '.sessionId')
  [ "$sid" = "session-abc" ]
  name=$(printf '%s' "$output" | jq -r '.name')
  [ "$name" = "tidy tests" ]
}

@test "claude_session_meta_for_pid is empty when no live file exists" {
  run claude_session_meta_for_pid 404
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "claude_session_meta_for_pid is empty for an empty pid" {
  run claude_session_meta_for_pid ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "claude_session_resolve_for_pid preserves pane and cwd arguments with spaces" {
  resolver="$HOME/resolver"
  write_executable "$resolver" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" >"$TEST_LOG"
printf '{"status":"resolved","sessionId":"session-xyz"}\n'
EOF
  export CLAUDE_SESSION_RESOLVER="$resolver"

  run claude_session_resolve_for_pid 711 "%1" "/tmp/work space"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-xyz" ]
  grep -qF '<--pane>' "$TEST_LOG"
  grep -qF '<%1>' "$TEST_LOG"
  grep -qF '<--cwd>' "$TEST_LOG"
  grep -qF '</tmp/work space>' "$TEST_LOG"
}

@test "agent_foreground_pid_for_tty finds the foreground claude on the tty" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ /opt/homebrew/bin/claude\n'
    ;;
  *) exit 1 ;;
esac
EOF

  run agent_foreground_pid_for_tty "/dev/ttys010" "claude"
  [ "$status" -eq 0 ]
  [ "$output" = "711" ]
}

@test "agent_foreground_pid_for_tty ignores a backgrounded claude on the tty" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  711 S claude\n'
    ;;
  *) exit 1 ;;
esac
EOF

  run agent_foreground_pid_for_tty "/dev/ttys010" "claude"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "agent_foreground_pid_for_tty falls back to a child of pane_pid" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    exit 0
    ;;
  *-ao*)
    printf '  711 500 claude\n'
    ;;
  *) exit 1 ;;
esac
EOF

  run agent_foreground_pid_for_tty "/dev/ttys010" "claude" "500"
  [ "$status" -eq 0 ]
  [ "$output" = "711" ]
}
