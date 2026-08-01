#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

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
  # -f /dev/null: bare server (see AGENTS.md) so the hook's agent-state.sh call,
  # not the real config's focus hooks, is what sets the pane option we assert on.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
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
    # </dev/null: stdin-reading hooks (atuin, guard-secret-paths-codex) must
    # not eat the loop's pipe; both exit 0 on an empty event.
    AGENT_STATE_PANE="$PANE" sh -c "$cmd" </dev/null
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

@test "every agent-state hook reaches agent-state.sh with kind codex and tolerates failure" {
  local cmd script seen=0
  while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    # The atuin command-capture hook (see ~/CLAUDE.md "Agent command history")
    # and the Bash guards (deliberately blocking, exit 2) coexist with the
    # agent-state hooks and are exempt from these assertions. Exempted by
    # naming convention, so a new guard-*-codex.py needs no edit here.
    [[ "$cmd" == "atuin hook codex"* ]] && continue
    [[ "$cmd" == *"guard-"*"-codex.py"* ]] && continue
    seen=1
    # By role, not by binary: a hook either calls agent-state.sh directly, or
    # calls an agent-*.sh adapter that forwards to it (agent-pretooluse.sh
    # reads the tool payload first). The forwarding is verified against the
    # adapter itself, so a new adapter needs no edit here.
    if [[ "$cmd" != *"agent-state.sh"* ]]; then
      [[ "$cmd" =~ agent-[a-z-]+\.sh ]]
      script="$HOME/.config/tmux/scripts/${BASH_REMATCH[0]}"
      [ -f "$script" ]
      grep -q 'agent-state\.sh' "$script"
    fi
    [[ "$cmd" == *" codex "* ]]
    [[ "$cmd" == *"|| true"* ]]
  done < <(jq -r '.hooks[][].hooks[].command' "$HOOKS")
  [ "$seen" = 1 ]
}

@test "PreToolUse wires the secret-path guard on Bash" {
  jq -r '.hooks.PreToolUse[] | select(.matcher=="^Bash$") | .hooks[].command' "$HOOKS" |
    grep -qF 'guard-secret-paths-codex.py'
}

@test "PreToolUse wires the mutating gh api guard on Bash" {
  # Codex has no permissions.ask, so this hook is its only cover for PR merges
  # and branch-protection writes.
  jq -r '.hooks.PreToolUse[] | select(.matcher=="^Bash$") | .hooks[].command' "$HOOKS" |
    grep -qF 'guard-mutating-api-codex.py'
}
