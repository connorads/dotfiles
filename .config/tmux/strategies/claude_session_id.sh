#!/usr/bin/env bash
# claude_session_id.sh: tmux-resurrect strategy for Claude Code
# Fidelity restore: rebuilds the saved pane argv ($1) with a fresh
# --resume <id> so flags like --dangerously-skip-permissions and
# --append-system-prompt-file survive; falls back to --continue.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

SAVED_COMMAND="$1"
DIRECTORY="$2"
SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

# shellcheck source=../scripts/lib/resurrect-argv.sh disable=SC1091
[ -f "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh" ] &&
	. "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh"

main() {
	local session_id=""
	local config_dir=""
	if [ -f "$SESSION_FILE" ] && command -v jq &>/dev/null; then
		local pane_key=""
		pane_key=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
		if [ -n "$pane_key" ]; then
			session_id=$(jq -r --arg pane_key "$pane_key" '.panes[$pane_key].claude // empty' "$SESSION_FILE" 2>/dev/null)
			config_dir=$(jq -r --arg pane_key "$pane_key" '.panes[$pane_key].claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null)
		fi
		if [ -z "$session_id" ]; then
			session_id=$(jq -r --arg dir "$DIRECTORY" '.[$dir].claude // empty' "$SESSION_FILE" 2>/dev/null)
			config_dir=$(jq -r --arg dir "$DIRECTORY" '.[$dir].claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null)
		fi
	fi

	local rebuilt=""
	if command -v resurrect_argv_claude &>/dev/null; then
		rebuilt=$(resurrect_argv_claude "$SAVED_COMMAND" "$session_id" "$config_dir") || rebuilt=""
	fi

	if [ -n "$rebuilt" ]; then
		echo "$rebuilt"
	elif [ -n "$session_id" ]; then
		echo "claude --resume $session_id"
	else
		echo "claude --continue"
	fi
}
main
