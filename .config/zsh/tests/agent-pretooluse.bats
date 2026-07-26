#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-pretooluse.sh"

# Same throwaway private tmux server as agent-journal.bats: the adapter forwards
# to agent-state.sh, which needs real pane/window resolution, and its journal
# capture is asserted here too (payload passthrough).
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  SOCK="agentpretool_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  export AGENT_JOURNAL_DIR="$BATS_TEST_TMPDIR/journal"
  PANE=$(tx display-message -p -t s '#{pane_id}')
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

journal_lines() { cat "$AGENT_JOURNAL_DIR"/events-*.jsonl 2>/dev/null; }
pstate() { tx show-options -pqv -t "$1" @agent_state; }

@test "request_user_input maps to blocked" {
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"request_user_input"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" codex
  [ "$(pstate "$PANE")" = blocked ]
}

@test "other tools map to working" {
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" codex
  [ "$(pstate "$PANE")" = working ]
}

@test "unparseable payload fails open to working" {
  printf 'not json at all' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" codex
  [ "$(pstate "$PANE")" = working ]
}

@test "missing tool_name maps to working" {
  printf '%s' '{"hook_event_name":"PreToolUse"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" codex
  [ "$(pstate "$PANE")" = working ]
}

@test "the payload is still journalled (passthrough)" {
  printf '%s' '{"hook_event_name":"PreToolUse","session_id":"pt-1","tool_name":"request_user_input"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" codex

  [ "$(journal_lines | wc -l | tr -d ' ')" = 1 ]
  journal_lines | jq -e '.state == "blocked" and .kind == "codex"
    and .event == "PreToolUse" and .session_id == "pt-1"
    and .tool_name == "request_user_input"'
}

@test "kind defaults to codex when no positional is passed" {
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT"
  [ "$(tx show-options -pqv -t "$PANE" @agent_kind)" = codex ]
}
