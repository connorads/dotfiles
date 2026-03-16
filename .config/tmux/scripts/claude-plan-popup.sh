#!/usr/bin/env bash
# claude-plan-popup: show the active Claude Code plan in a tmux popup
# Usage (preflight): claude-plan-popup <pane_pid> <pane_current_command>
# Usage (exec):      claude-plan-popup --exec <plan_file>
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
PLANS_DIR="$CLAUDE_DIR/plans"
SESSIONS_DIR="$CLAUDE_DIR/sessions"
PROJECTS_DIR="$CLAUDE_DIR/projects"

# --- Detection functions ---

find_claude_pane_pid() {
  local pane_pid="$1" pane_cmd="$2"
  # Fast path: focused pane is already running claude
  if [[ "$pane_cmd" == "claude" ]]; then
    printf "%s" "$pane_pid"
    return 0
  fi
  # Scan current tmux session for a claude pane
  local line
  line=$(tmux list-panes -s -F '#{pane_pid} #{pane_current_command}' | grep ' claude$' | head -1)
  if [[ -n "$line" ]]; then
    printf "%s" "${line%% *}"
    return 0
  fi
  return 1
}

find_claude_pid() {
  local pane_pid="$1"
  local child comm
  for child in $(pgrep -P "$pane_pid" 2>/dev/null); do
    comm=$(ps -o comm= -p "$child" 2>/dev/null) || continue
    if [[ "$comm" == "claude" ]]; then
      printf "%s" "$child"
      return 0
    fi
    # One level deeper (mise shims etc.)
    local gc
    for gc in $(pgrep -P "$child" 2>/dev/null); do
      comm=$(ps -o comm= -p "$gc" 2>/dev/null) || continue
      if [[ "$comm" == "claude" ]]; then
        printf "%s" "$gc"
        return 0
      fi
    done
  done
  return 1
}

find_session_id() {
  local claude_pid="$1"
  local session_file="$SESSIONS_DIR/$claude_pid.json"
  [[ -f "$session_file" ]] || return 1
  grep -o '"sessionId":"[^"]*"' "$session_file" | head -1 | sed 's/"sessionId":"//;s/"//'
}

find_plan_slug() {
  local session_id="$1"
  local jsonl
  jsonl=$(find "$PROJECTS_DIR" -name "${session_id}.jsonl" -print -quit 2>/dev/null)
  [[ -n "$jsonl" ]] || return 1
  grep -o '"slug":"[^"]*"' "$jsonl" | tail -1 | sed 's/"slug":"//;s/"//'
}

resolve_plan_file() {
  local slug="$1" session_id="$2"
  local jsonl agent_id agent_plan main_plan

  main_plan="$PLANS_DIR/${slug}.md"

  # Try to find agent-specific variant
  jsonl=$(find "$PROJECTS_DIR" -name "${session_id}.jsonl" -print -quit 2>/dev/null)
  if [[ -n "$jsonl" ]]; then
    agent_id=$(grep -o '"agentId":"[^"]*"' "$jsonl" | tail -1 | sed 's/"agentId":"//;s/"//')
    if [[ -n "$agent_id" ]]; then
      agent_plan="$PLANS_DIR/${slug}-agent-${agent_id}.md"
      if [[ -f "$agent_plan" ]]; then
        printf "%s" "$agent_plan"
        return 0
      fi
    fi
  fi

  if [[ -f "$main_plan" ]]; then
    printf "%s" "$main_plan"
    return 0
  fi
  return 1
}

find_latest_plan() {
  # shellcheck disable=SC2012
  ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1
}

# --- Exec mode: render plan in popup ---

show_plan() {
  local plan_file="$1"
  if command -v glow >/dev/null 2>&1; then
    glow -p -s dark "$plan_file"
  elif command -v bat >/dev/null 2>&1; then
    bat --style=plain --paging=always --language=markdown "$plan_file"
  else
    less "$plan_file"
  fi
}

# --- Entrypoint ---

if [[ "${1:-}" == "--exec" ]]; then
  show_plan "${2:?plan file path required}"
  exit 0
fi

# Preflight mode
pane_pid="${1:?pane_pid required}"
pane_cmd="${2:-zsh}"
plan_file=""

claude_pane_pid=$(find_claude_pane_pid "$pane_pid" "$pane_cmd") || true
if [[ -n "$claude_pane_pid" ]]; then
  claude_pid=$(find_claude_pid "$claude_pane_pid") || true
  if [[ -n "${claude_pid:-}" ]]; then
    session_id=$(find_session_id "$claude_pid") || true
    if [[ -n "${session_id:-}" ]]; then
      slug=$(find_plan_slug "$session_id") || true
      if [[ -n "${slug:-}" ]]; then
        plan_file=$(resolve_plan_file "$slug" "$session_id") || true
      fi
    fi
  fi
fi

# Fallback: most recently modified plan
if [[ -z "$plan_file" ]]; then
  plan_file=$(find_latest_plan)
  if [[ -z "$plan_file" ]]; then
    tmux display-message "No Claude Code plans found"
    exit 0
  fi
  basename=$(basename "$plan_file" .md)
  tmux display-message "No active plan in pane; showing latest: $basename"
fi

tmux display-popup -E -w 80% -h 80% \
  "$HOME/.config/tmux/scripts/claude-plan-popup.sh --exec '$plan_file'"
