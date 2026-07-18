#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-state.sh"
STOP_SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-stop.sh"

# Same throwaway private tmux server as agent-state.bats: the journal is written
# by agent-state.sh, which needs real pane/window resolution.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  SOCK="agentjournal_${BATS_TEST_NUMBER}_$$"
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

@test "hook payload fields land in the journal line" {
  printf '%s' '{"hook_event_name":"PreToolUse","session_id":"abc123","cwd":"/tmp/proj","permission_mode":"plan","tool_name":"Bash"}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" working claude

  [ "$(journal_lines | wc -l | tr -d ' ')" = 1 ]
  journal_lines | jq -e --arg pane "$PANE" '
    .state == "working" and .kind == "claude" and .pane == $pane
    and .event == "PreToolUse" and .session_id == "abc123"
    and .cwd == "/tmp/proj" and .permission_mode == "plan"
    and .tool_name == "Bash" and .stop_reason == null
    and .plan == null and (.ts | type) == "string"'
}

@test "ExitPlanMode tool_input is captured verbatim as plan" {
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"Do the thing"}}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" working claude

  journal_lines | jq -e '.tool_name == "ExitPlanMode" and .plan.plan == "Do the thing"'
}

@test "non-ExitPlanMode tool_input is not journalled" {
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"content":"secret-laden file body"}}' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" working claude

  journal_lines | jq -e '.tool_name == "Write" and .plan == null'
  run --keep-empty-lines grep -c secret-laden "$AGENT_JOURNAL_DIR"/events-*.jsonl
  [ "$status" -ne 0 ] || [ "${lines[0]}" = 0 ]
}

@test "unparseable stdin still journals the state transition" {
  printf 'not json at all' |
    env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" blocked claude

  journal_lines | jq -e '.state == "blocked" and .event == null and .session_id == null'
}

@test "no stdin still journals the state transition" {
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" done claude </dev/null

  # done on the focused window ages straight to idle, but the journalled verb
  # is the one the hook sent.
  journal_lines | jq -e '.state == "done" and .event == null'
}

@test "AGENT_JOURNAL_DISABLE=1 writes nothing but still sets state" {
  printf '%s' '{"hook_event_name":"PreToolUse"}' |
    env AGENT_STATE_PANE="$PANE" AGENT_JOURNAL_DISABLE=1 sh "$SCRIPT" working claude

  [ ! -d "$AGENT_JOURNAL_DIR" ]
  [ "$(tx show-options -pqv -t "$PANE" @agent_state)" = working ]
}

@test "events append across invocations" {
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" working claude </dev/null
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" blocked claude </dev/null

  [ "$(journal_lines | wc -l | tr -d ' ')" = 2 ]
  [ "$(journal_lines | jq -rs '.[1].state')" = blocked ]
}

@test "seen that ages done to idle is journalled; a no-op seen is not" {
  tx set-option -p -t "$PANE" @agent_state done
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" seen </dev/null
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" seen </dev/null

  [ "$(journal_lines | wc -l | tr -d ' ')" = 1 ]
  journal_lines | jq -e '.state == "seen" and .kind == null'
}

@test "journal file is named by UTC month" {
  env AGENT_STATE_PANE="$PANE" sh "$SCRIPT" working claude </dev/null

  ls "$AGENT_JOURNAL_DIR" | grep -Eq '^events-[0-9]{4}-[0-9]{2}\.jsonl$'
}

@test "agent-stop passes the Stop payload through to the journal" {
  printf '%s' '{"hook_event_name":"Stop","session_id":"stop-1","stop_reason":"end_turn","background_tasks":[]}' |
    env AGENT_STATE_PANE="$PANE" sh "$STOP_SCRIPT"

  journal_lines | jq -e '.state == "done" and .event == "Stop" and .session_id == "stop-1"
    and .stop_reason == "end_turn"'
}

@test "agent-stop journals working while background tasks drain" {
  printf '%s' '{"hook_event_name":"Stop","background_tasks":[{"type":"workflow"}]}' |
    env AGENT_STATE_PANE="$PANE" sh "$STOP_SCRIPT"

  journal_lines | jq -e '.state == "working" and .event == "Stop"'
}
