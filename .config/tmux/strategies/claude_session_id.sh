#!/usr/bin/env bash
# claude_session_id.sh: tmux-resurrect strategy for Claude Code
# Resumes the specific session that was running, falling back to --continue.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

ORIGINAL_COMMAND="$1"
DIRECTORY="$2"
SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

main() {
  local session_id=""
  if [ -f "$SESSION_FILE" ] && command -v jq &>/dev/null; then
    session_id=$(jq -r --arg dir "$DIRECTORY" '.[$dir].claude // empty' "$SESSION_FILE" 2>/dev/null)
  fi

  if [ -n "$session_id" ]; then
    echo "claude --resume $session_id"
  else
    echo "claude --continue"
  fi
}
main
