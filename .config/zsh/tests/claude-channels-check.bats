#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CHECK="$FUNCTIONS_DIR/claude/claude-channels-check"
MARKER_REL=".cache/claude-channels.stale"

setup() {
  setup_test_home
  MARKER="$HOME/$MARKER_REL"
  # Same root the checker computes: native cache dir on darwin, XDG elsewhere.
  case "$OSTYPE" in
  darwin*) ROOT="$HOME/Library/Caches/claude-cli-nodejs" ;;
  *) ROOT="$HOME/.cache/claude-cli-nodejs" ;;
  esac
}

# write_log <project-dir-name> <debug-text>...
write_log() {
  local project=$1
  shift
  local dir="$ROOT/$project/mcp-logs-plugin-telegram-telegram"
  mkdir -p "$dir"
  local line
  for line in "$@"; do
    printf '{"debug":"%s","timestamp":"2026-09-10T00:00:00.000Z"}\n' "$line"
  done >"$dir/2026-09-10T00-00-00-000Z.jsonl"
}

@test "no cache root at all is silent and successful" {
  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ ! -e "$MARKER" ]
}

@test "a log with no Channel notifications line writes nothing" {
  write_log -Users-me-proj 'MCP server started'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ ! -e "$MARKER" ]
}

@test "a skipped registration writes the marker with the skip reason" {
  write_log -Users-me-proj \
    'Channel notifications skipped: channels feature is not currently available'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ -f "$MARKER" ]
  grep -q '^reason: skipped: channels feature is not currently available$' "$MARKER"
  grep -q '^target: .*mcp-logs-plugin-telegram-telegram' "$MARKER"
  grep -q '^when:   [0-9]' "$MARKER"
}

@test "a registered channel clears an existing marker" {
  mkdir -p "$HOME/.cache"
  printf 'reason: stale from last time\n' >"$MARKER"
  write_log -Users-me-proj 'Channel notifications registered'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ ! -e "$MARKER" ]
}

@test "re-registered after reconnect counts as healthy" {
  mkdir -p "$HOME/.cache"
  printf 'reason: stale from last time\n' >"$MARKER"
  write_log -Users-me-proj 'Channel notifications re-registered after reconnect'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ ! -e "$MARKER" ]
}

@test "the last line in the log is the verdict" {
  write_log -Users-me-proj \
    'Channel notifications registered' \
    'Channel notifications skipped: channels feature is not currently available'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  grep -q '^reason: skipped: ' "$MARKER"
}

@test "the newest project log wins over an older one" {
  write_log -Users-me-old \
    'Channel notifications skipped: channels feature is not currently available'
  # Distinct mtimes: the checker orders by modification time, newest first.
  touch -t 202001010000 \
    "$ROOT/-Users-me-old/mcp-logs-plugin-telegram-telegram/"*.jsonl
  write_log -Users-me-new 'Channel notifications registered'

  run_zsh_function "$CHECK"

  [ "$status" -eq 0 ]
  [ ! -e "$MARKER" ]
}
