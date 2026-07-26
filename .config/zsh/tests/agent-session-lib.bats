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

@test "claude_session_meta_for_pid honours a profile config_dir" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/sessions"
  cat >"$cfg/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-profile","cwd":"/Users/connorads"}
EOF

  run claude_session_meta_for_pid 901 "$cfg"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-profile" ]

  # The default account has no such session, so an empty config_dir stays default.
  run claude_session_meta_for_pid 901 ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "claude_config_dir_for_pid reads CLAUDE_CONFIG_DIR from proc environ" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$BATS_TEST_TMPDIR/proc/901"
  printf 'HOME=%s\0CLAUDE_CONFIG_DIR=%s\0SECRET_TOKEN=hunter2\0' "$HOME" "$cfg" \
    >"$BATS_TEST_TMPDIR/proc/901/environ"

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc" run claude_config_dir_for_pid 901
  [ "$status" -eq 0 ]
  [ "$output" = "$cfg" ]
  # Only CLAUDE_CONFIG_DIR may surface - the environ exposes real secrets.
  [[ "$output" != *hunter2* ]]
}

@test "claude_config_dir_for_pid falls back to ps -E on macOS" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  write_stub ps <<EOF
#!/usr/bin/env bash
case "\$*" in
  *-E*901*) printf 'claude --resume s1 CLAUDE_CONFIG_DIR=%s SECRET_TOKEN=hunter2\n' "$cfg" ;;
  *) exit 1 ;;
esac
EOF

  # An unreadable proc root forces the ps -E path.
  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run claude_config_dir_for_pid 901
  [ "$status" -eq 0 ]
  [ "$output" = "$cfg" ]
  [[ "$output" != *hunter2* ]]
}

@test "claude_config_dir_for_pid is empty for a default-account pid" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-E*901*) printf 'claude --resume s1\n' ;;
  *) exit 1 ;;
esac
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run claude_config_dir_for_pid 901
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "claude_config_dir_for_pid is empty for an empty pid" {
  run claude_config_dir_for_pid ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "claude_session_resolve_for_pid appends --config-dir when given" {
  resolver="$HOME/resolver"
  write_executable "$resolver" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" >"$TEST_LOG"
printf '{"status":"resolved","sessionId":"session-xyz"}\n'
EOF
  export CLAUDE_SESSION_RESOLVER="$resolver"

  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  run claude_session_resolve_for_pid 711 "%1" "/tmp/work" "$cfg"
  [ "$status" -eq 0 ]
  grep -qF '<--config-dir>' "$TEST_LOG"
  grep -qF "<$cfg>" "$TEST_LOG"
}

@test "claude_session_resolve_for_pid omits --config-dir when empty" {
  resolver="$HOME/resolver"
  write_executable "$resolver" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" >"$TEST_LOG"
printf '{"status":"resolved","sessionId":"session-xyz"}\n'
EOF
  export CLAUDE_SESSION_RESOLVER="$resolver"

  run claude_session_resolve_for_pid 711 "%1" "/tmp/work"
  [ "$status" -eq 0 ]
  ! grep -qF '<--config-dir>' "$TEST_LOG"
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

# --- lsof resolution -------------------------------------------------------
# Codex ids are resolved from the transcript the process holds open, so a caller
# with a narrow PATH (a launchd agent gets only what its plist lists) would
# otherwise record nothing at all rather than reporting a missing tool.

# An lsof stub reporting one open Codex rollout for any pid.
write_lsof_stub_at() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat >"$path" <<EOF
#!/usr/bin/env bash
printf 'codex 901 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-one.jsonl\n' "\$HOME"
EOF
  chmod +x "$path"
}

# A PATH with no lsof anywhere - the launchd shape (the plist lists none of the
# dirs holding it). setup_test_home's own PATH includes /usr/sbin, where macOS
# keeps lsof, so a test must drop it to exercise the fallback at all.
lsofless_path() { printf '%s' "$TEST_BIN:/usr/bin:/bin"; }

@test "agent_lsof_command prefers lsof on PATH" {
  write_lsof_stub_at "$TEST_BIN/lsof"

  run agent_lsof_command
  [ "$status" -eq 0 ]
  [ "$output" = "lsof" ]
}

@test "agent_lsof_command falls back to the system lsof when PATH has none" {
  local fallback="$BATS_TEST_TMPDIR/sbin/lsof"
  write_lsof_stub_at "$fallback"

  PATH="$(lsofless_path)" AGENT_LSOF_FALLBACK="$fallback" run agent_lsof_command
  [ "$status" -eq 0 ]
  [ "$output" = "$fallback" ]
}

@test "agent_lsof_command is empty when lsof is absent everywhere" {
  PATH="$(lsofless_path)" AGENT_LSOF_FALLBACK="$BATS_TEST_TMPDIR/sbin/absent" run agent_lsof_command
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "codex_session_file_for_pid resolves via the fallback lsof with none on PATH" {
  local fallback="$BATS_TEST_TMPDIR/sbin/lsof"
  write_lsof_stub_at "$fallback"

  PATH="$(lsofless_path)" AGENT_LSOF_FALLBACK="$fallback" run codex_session_file_for_pid 901
  [ "$status" -eq 0 ]
  [ "$output" = "$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl" ]
}

@test "codex_session_file_for_pid is empty when no lsof can be found" {
  PATH="$(lsofless_path)" AGENT_LSOF_FALLBACK="$BATS_TEST_TMPDIR/sbin/absent" run codex_session_file_for_pid 901
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
