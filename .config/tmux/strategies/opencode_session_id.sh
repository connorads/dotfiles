#!/usr/bin/env bash
# opencode_session_id.sh: tmux-resurrect strategy for OpenCode
# Fidelity restore: rebuilds the saved pane argv ($1) with a fresh
# --session <id> (falling back to --continue) and, when the save hook
# recorded OPENCODE_CONFIG_CONTENT (ocy's yolo mode - invisible in argv),
# prefixes it as an inline env assignment; resurrect types the command into
# the pane's shell, so the prefix takes effect.
# Reads session IDs from the companion file written by resurrect-save-sessions.sh.

# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

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
