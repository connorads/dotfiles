#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# Guards the Codex agent-tracking wiring (phase 3): ~/.codex/hooks.json maps each
# lifecycle event to agent-state.sh with the right state, [features] hooks = true
# is set, SubagentStop is NOT wired (a sub-agent finishing must not fake idle),
# and every command tolerates failure so a blocking PreToolUse/PermissionRequest
# hook can never deny a tool. The state assertions are behavioural: each hook's
# real command runs against a throwaway tmux server and we check the pane option.
HOOKS="$HOME/.codex/hooks.json"
CONFIG="$HOME/.codex/config.toml"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  command -v jq >/dev/null || skip "jq not installed"
  [ -f "$HOOKS" ] || skip "no codex hooks.json"
  SOCK="codexhooks_${BATS_TEST_NUMBER}_$$"
  tx new-session -d -s s -x 80 -y 24
  PANE=$(tx display-message -p -t s '#{pane_id}') # first window's pane...
  tx new-window -t s                              # ...now inactive, so done stays done
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# Run every command Codex would run for EVENT, against PANE on the private server
# (AGENT_STATE_PANE stands in for the $TMUX_PANE the real hook would inherit).
fire() {
  local cmd
  while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    AGENT_STATE_PANE="$PANE" sh -c "$cmd"
  done < <(jq -r ".hooks[\"$1\"][].hooks[].command" "$HOOKS")
}
pstate() { tx show-options -pqv -t "$PANE" @agent_state; }

@test "UserPromptSubmit drives the pane to working" {
  fire UserPromptSubmit
  [ "$(pstate)" = working ]
}

@test "PreToolUse drives the pane to working" {
  fire PreToolUse
  [ "$(pstate)" = working ]
}

@test "PostToolUse drives the pane to working (resume after approval)" {
  fire PostToolUse
  [ "$(pstate)" = working ]
}

@test "PermissionRequest drives the pane to blocked" {
  fire PermissionRequest
  [ "$(pstate)" = blocked ]
}

@test "Stop drives an inactive pane to done" {
  fire Stop
  [ "$(pstate)" = done ]
}

@test "SessionStart clears a stale dot (pane reuse)" {
  fire Stop
  [ "$(pstate)" = done ]
  fire SessionStart
  [ -z "$(pstate)" ]
}

@test "[features] hooks = true is set in config.toml" {
  [ -f "$CONFIG" ] || skip "no codex config.toml"
  grep -qE '^hooks = true$' "$CONFIG"
}

@test "SubagentStop is not wired (must not fake top-level idle)" {
  [ "$(jq -r '.hooks.SubagentStop' "$HOOKS")" = null ]
}

@test "every hook command targets agent-state.sh with kind codex and tolerates failure" {
  local cmd seen=0
  while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    seen=1
    [[ "$cmd" == *"agent-state.sh"* ]]
    [[ "$cmd" == *" codex "* ]]
    [[ "$cmd" == *"|| true"* ]]
  done < <(jq -r '.hooks[][].hooks[].command' "$HOOKS")
  [ "$seen" = 1 ]
}
