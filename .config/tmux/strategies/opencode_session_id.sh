#!/usr/bin/env bash
# opencode_session_id.sh: tmux-resurrect strategy for OpenCode
# Resumes the specific session that was running, falling back to --continue.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

ORIGINAL_COMMAND="$1"
DIRECTORY="$2"
SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

main() {
  local session_id=""
  if [ -f "$SESSION_FILE" ] && command -v jq &>/dev/null; then
    session_id=$(jq -r --arg dir "$DIRECTORY" '.[$dir].opencode // empty' "$SESSION_FILE" 2>/dev/null)
  fi

  if [ -n "$session_id" ]; then
    echo "opencode --session $session_id"
  else
    echo "opencode --continue"
  fi
}
main
