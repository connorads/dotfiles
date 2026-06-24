#!/usr/bin/env bash
# codex_session_id.sh: tmux-resurrect strategy for Codex
# Resumes the specific session that was running, falling back to --last.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

DIRECTORY="$2"
SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

main() {
	local session_id=""
	if [ -f "$SESSION_FILE" ] && command -v jq &>/dev/null; then
		local pane_key=""
		pane_key=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
		if [ -n "$pane_key" ]; then
			session_id=$(jq -r --arg pane_key "$pane_key" '.panes[$pane_key].codex // empty' "$SESSION_FILE" 2>/dev/null)
		fi
		if [ -z "$session_id" ]; then
			session_id=$(jq -r --arg dir "$DIRECTORY" '.[$dir].codex // empty' "$SESSION_FILE" 2>/dev/null)
		fi
	fi

	if [ -n "$session_id" ]; then
		echo "codex resume $session_id"
	else
		echo "codex resume --last"
	fi
}
main
