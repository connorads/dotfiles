#!/usr/bin/env bash
# resurrect-save-sessions.sh: post-save hook for tmux-resurrect
# Discovers active Claude Code and OpenCode session IDs and writes a
# companion JSON file that strategy scripts read at restore time.

set -euo pipefail

SAVE_FILE="$1"
RESURRECT_DIR="$(dirname "$SAVE_FILE")"
SESSION_FILE="$RESURRECT_DIR/session_ids.json"

# Require jq
if ! command -v jq &>/dev/null; then
  exit 0
fi

declare -A CLAUDE_SESSIONS
declare -A OPENCODE_SESSIONS

# --- Claude Code session discovery ---
# Session files: ~/.claude/projects/<project-hash>/<uuid>.jsonl
# Project hash = directory path with / replaced by -
find_claude_session() {
  local dir="$1"
  local pid="$2"
  local session_id=""

  # Try lsof first — find .jsonl files the process has open
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    session_id=$(lsof -p "$pid" 2>/dev/null \
      | grep '\.jsonl$' \
      | grep '\.claude/projects/' \
      | awk '{print $NF}' \
      | head -1 \
      | xargs -I{} basename {} .jsonl 2>/dev/null || true)
  fi

  # Fallback: most recently modified .jsonl in the project dir
  if [ -z "$session_id" ]; then
    local project_hash
    project_hash=$(echo "$dir" | sed 's|/|-|g')
    local project_dir="$HOME/.claude/projects/$project_hash"
    if [ -d "$project_dir" ]; then
      local latest
      latest=$(ls -t "$project_dir"/*.jsonl 2>/dev/null | head -1)
      if [ -n "$latest" ]; then
        session_id=$(basename "$latest" .jsonl)
      fi
    fi
  fi

  echo "$session_id"
}

# --- OpenCode session discovery ---
# Session files: ~/.local/share/opencode/storage/session/<project-id>/ses_*.json
# Project mapping: ~/.local/share/opencode/storage/project/*.json (id -> worktree)
find_opencode_session() {
  local dir="$1"
  local pid="$2"
  local session_id=""

  # Try lsof first
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    session_id=$(lsof -p "$pid" 2>/dev/null \
      | grep '/opencode/storage/session/' \
      | grep '\.json$' \
      | awk '{print $NF}' \
      | head -1 \
      | xargs -I{} basename {} .json 2>/dev/null || true)
  fi

  # Fallback: find project ID for this directory, then most recent session file
  if [ -z "$session_id" ]; then
    local project_dir="$HOME/.local/share/opencode/storage/project"
    if [ -d "$project_dir" ]; then
      local project_id=""
      # Search project files for matching worktree
      for pf in "$project_dir"/*.json; do
        [ -f "$pf" ] || continue
        local worktree
        worktree=$(jq -r '.worktree // empty' "$pf" 2>/dev/null)
        if [ "$worktree" = "$dir" ]; then
          project_id=$(jq -r '.id // empty' "$pf" 2>/dev/null)
          break
        fi
      done

      if [ -n "$project_id" ]; then
        local session_dir="$HOME/.local/share/opencode/storage/session/$project_id"
        if [ -d "$session_dir" ]; then
          local latest
          latest=$(ls -t "$session_dir"/ses_*.json 2>/dev/null | head -1)
          if [ -n "$latest" ]; then
            session_id=$(basename "$latest" .json)
          fi
        fi
      fi
    fi
  fi

  echo "$session_id"
}

# --- Get pane PIDs from tmux (still running at hook time) ---
# Returns: session:window.pane<TAB>pid<TAB>command<TAB>cwd
get_live_panes() {
  tmux list-panes -a -F '#{pane_pid}	#{pane_current_command}	#{pane_current_path}' 2>/dev/null || true
}

# --- Parse save file for panes running claude or opencode ---
# Save file pane format (tab-delimited):
# pane<TAB>session<TAB>window<TAB>win_active<TAB>:flags<TAB>pane_idx<TAB>:title<TAB>:dir<TAB>pane_active<TAB>pane_cmd<TAB>:full_cmd
# But PID is not in the save file — we use live tmux panes instead.

# Read live pane data and match against claude/opencode
while IFS=$'\t' read -r pid cmd dir; do
  case "$cmd" in
    claude)
      sid=$(find_claude_session "$dir" "$pid")
      if [ -n "$sid" ]; then
        CLAUDE_SESSIONS["$dir"]="$sid"
      fi
      ;;
    opencode)
      sid=$(find_opencode_session "$dir" "$pid")
      if [ -n "$sid" ]; then
        OPENCODE_SESSIONS["$dir"]="$sid"
      fi
      ;;
  esac
done < <(get_live_panes)

# --- Write companion JSON ---
# Collect all unique directories
declare -A ALL_DIRS
for dir in "${!CLAUDE_SESSIONS[@]}"; do ALL_DIRS["$dir"]=1; done
for dir in "${!OPENCODE_SESSIONS[@]}"; do ALL_DIRS["$dir"]=1; done

if [ ${#ALL_DIRS[@]} -eq 0 ]; then
  # No sessions found — remove stale file if present
  rm -f "$SESSION_FILE"
  exit 0
fi

# Build JSON with jq
json="{}"
for dir in "${!ALL_DIRS[@]}"; do
  entry="{}"
  if [ -n "${CLAUDE_SESSIONS[$dir]:-}" ]; then
    entry=$(echo "$entry" | jq --arg sid "${CLAUDE_SESSIONS[$dir]}" '. + {claude: $sid}')
  fi
  if [ -n "${OPENCODE_SESSIONS[$dir]:-}" ]; then
    entry=$(echo "$entry" | jq --arg sid "${OPENCODE_SESSIONS[$dir]}" '. + {opencode: $sid}')
  fi
  json=$(echo "$json" | jq --arg dir "$dir" --argjson entry "$entry" '. + {($dir): $entry}')
done

echo "$json" | jq '.' > "$SESSION_FILE"
