#!/usr/bin/env bash
# resurrect-codex-launch.sh: runs INSIDE a restored tmux pane to resume the
# right Codex conversation. Identity is exact: $TMUX_PANE names this pane
# unambiguously, so it reads its own live pane key and looks up the matching
# session id in session_ids.json. This deliberately replaces resolving the
# session in the eval-time strategy, where the active-pane read is a race (and
# plain wrong with no client attached). Flags to preserve arrive as "$@".
#
# Degrades to `codex resume --last "$@"` whenever exact identity can't be
# resolved (missing jq / session file / $TMUX_PANE, or an ambiguous cwd) - it
# never guesses a wrong resume, which was the multi-pane-same-cwd bug this
# replaces.

SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

resume=""

if command -v jq &>/dev/null && [ -f "$SESSION_FILE" ] && [ -n "${TMUX_PANE:-}" ]; then
	pane_key=$(tmux display-message -pt "$TMUX_PANE" '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
	if [ -n "$pane_key" ]; then
		resume=$(jq -r --arg k "$pane_key" '.panes[$k].codex // empty' "$SESSION_FILE" 2>/dev/null || true)
	fi

	# Safe cwd fallback on exact-key miss: use it only when EXACTLY one recorded
	# pane owns this cwd. 0 or >1 -> do not guess (the regression guard).
	if [ -z "$resume" ]; then
		local_matches=$(jq -r --arg dir "$PWD" '[.panes[] | select(.dir == $dir and (.codex // "") != "")] | length' "$SESSION_FILE" 2>/dev/null || echo 0)
		if [ "$local_matches" = "1" ]; then
			resume=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.codex // "") != "")) | .codex' "$SESSION_FILE" 2>/dev/null || true)
		fi
	fi
fi

if [ -n "$resume" ]; then
	exec codex resume "$resume" "$@"
fi
exec codex resume --last "$@"
