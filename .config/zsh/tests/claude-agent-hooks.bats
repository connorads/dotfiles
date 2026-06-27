#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# Guards the agent-tracking hooks wired into ~/.claude/settings.json (phase 2):
# the lifecycle events must map to agent-state.sh with the right states, the
# pre-existing Bash guards must survive, and SubagentStop must NOT be wired (a
# sub-agent finishing must not fake top-level idle).
SETTINGS="$HOME/.claude/settings.json"

cmds() { jq -r "$1" "$SETTINGS"; }

setup() {
  command -v jq >/dev/null || skip "jq not installed"
  [ -f "$SETTINGS" ] || skip "no settings.json"
}

@test "settings.json is valid JSON" {
  run jq empty "$SETTINGS"
  [ "$status" -eq 0 ]
}

@test "UserPromptSubmit marks working" {
  cmds '.hooks.UserPromptSubmit[].hooks[].command' | grep -qF 'agent-state.sh working claude'
}

@test "PreToolUse marks working for all tools and keeps the Bash guards" {
  cmds '.hooks.PreToolUse[] | select(.matcher=="*") | .hooks[].command' | grep -qF 'agent-state.sh working claude'
  guards=$(cmds '.hooks.PreToolUse[] | select(.matcher=="Bash") | .hooks[].command')
  echo "$guards" | grep -qF 'no-self-attribution.py'
  echo "$guards" | grep -qF 'guard-mutating-api.py'
  echo "$guards" | grep -qF 'allow-local-curl.py'
}

@test "PostToolUse marks working (resume after approval)" {
  cmds '.hooks.PostToolUse[].hooks[].command' | grep -qF 'agent-state.sh working claude'
}

@test "PermissionRequest marks blocked" {
  cmds '.hooks.PermissionRequest[].hooks[].command' | grep -qF 'agent-state.sh blocked claude'
}

@test "permission_prompt notification marks blocked" {
  cmds '.hooks.Notification[] | select(.matcher=="permission_prompt") | .hooks[].command' | grep -qF 'agent-state.sh blocked claude'
}

@test "Stop marks done" {
  cmds '.hooks.Stop[].hooks[].command' | grep -qF 'agent-state.sh done claude'
}

@test "SessionEnd clears the dot" {
  cmds '.hooks.SessionEnd[].hooks[].command' | grep -qF 'agent-state.sh clear'
}

@test "SubagentStop is not wired (must not fake top-level idle)" {
  [ "$(cmds '.hooks.SubagentStop')" = "null" ]
}

@test "agent-state hooks never block a tool (|| true)" {
  # Every agent-state command tolerates failure so a side-effect hook can't
  # return exit 2 and veto a tool call.
  while IFS= read -r c; do
    case "$c" in
    *agent-state.sh*) [[ "$c" == *"|| true"* ]] ;;
    esac
  done < <(cmds '.hooks[][].hooks[].command')
}
