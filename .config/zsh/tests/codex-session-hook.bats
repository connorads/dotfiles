#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
source "$BATS_TEST_DIRNAME/test_helper.bash"

HOOK="$BATS_TEST_DIRNAME/../../tmux/scripts/agent-codex-session.sh"

setup() {
  setup_test_home
  export TMUX_PANE=%7
  export HOOK_LOG="$BATS_TEST_TMPDIR/tmux.log"
  export AGENT_STATE_SH="$BATS_TEST_TMPDIR/agent-state"
  write_stub tmux <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$HOOK_LOG"
case "$*" in *show-options*) printf '%s\n' "${HOOK_STATE:-idle}" ;; esac
EOF
  write_executable "$AGENT_STATE_SH" <<'EOF'
#!/bin/sh
printf 'agent-state %s\n' "$*" >>"$HOOK_LOG"
EOF
}

@test "SessionStart publishes the current thread id from session metadata" {
  rollout="$BATS_TEST_TMPDIR/rollout.jsonl"
  printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-current","session_id":"thread-root"}}' >"$rollout"
  jq -n --arg path "$rollout" '{hook_event_name:"SessionStart", session_id:"thread-root", transcript_path:$path}' |
    "$HOOK"

  grep -q '@codex_rollout_path.*rollout.jsonl' "$HOOK_LOG"
  grep -q '@codex_thread_id thread-current' "$HOOK_LOG"
  grep -q '@codex_started_thread thread-current' "$HOOK_LOG"
  ! grep -q 'thread-root' "$HOOK_LOG"
}

@test "SessionStart does not clear a pane while thaw is hibernated" {
  export HOOK_STATE=hibernated
  rollout="$BATS_TEST_TMPDIR/rollout.jsonl"
  printf '%s\n' '{"type":"session_meta","payload":{"id":"thread-current"}}' >"$rollout"
  jq -n --arg path "$rollout" '{hook_event_name:"SessionStart", transcript_path:$path}' | "$HOOK"

  ! grep -q '^agent-state' "$HOOK_LOG"
}
