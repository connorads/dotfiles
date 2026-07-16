#!/usr/bin/env bash
# opencode_session_id.sh: tmux-resurrect strategy for OpenCode
# Fidelity restore: rebuilds the saved pane argv ($1) with a fresh
# --session <id> (falling back to --continue) and, when the save hook
# recorded OPENCODE_CONFIG_CONTENT (ocy's yolo mode - invisible in argv),
# prefixes it as an inline env assignment; resurrect types the command into
# the pane's shell, so the prefix takes effect.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

SAVED_COMMAND="$1"
DIRECTORY="$2"
SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

# shellcheck source=../scripts/lib/resurrect-argv.sh disable=SC1091
[ -f "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh" ] &&
	. "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh"

main() {
	local session_id=""
	local env_value=""
	if [ -f "$SESSION_FILE" ] && command -v jq &>/dev/null; then
		local pane_key=""
		pane_key=$(tmux display-message -p '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
		if [ -n "$pane_key" ]; then
			session_id=$(jq -r --arg pane_key "$pane_key" '.panes[$pane_key].opencode // empty' "$SESSION_FILE" 2>/dev/null)
			env_value=$(jq -r --arg pane_key "$pane_key" '.panes[$pane_key].opencodeEnv // empty' "$SESSION_FILE" 2>/dev/null)
		fi
		if [ -z "$session_id" ]; then
			session_id=$(jq -r --arg dir "$DIRECTORY" '.[$dir].opencode // empty' "$SESSION_FILE" 2>/dev/null)
			env_value=$(jq -r --arg dir "$DIRECTORY" '.[$dir].opencodeEnv // empty' "$SESSION_FILE" 2>/dev/null)
		fi
	fi

	local rebuilt=""
	if command -v resurrect_argv_opencode &>/dev/null; then
		rebuilt=$(resurrect_argv_opencode "$SAVED_COMMAND" "$session_id" "$env_value") || rebuilt=""
	fi

	if [ -n "$rebuilt" ]; then
		echo "$rebuilt"
	elif [ -n "$session_id" ]; then
		echo "opencode --session $session_id"
	else
		echo "opencode --continue"
	fi
}
main
