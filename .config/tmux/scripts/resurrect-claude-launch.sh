#!/usr/bin/env bash
# resurrect-claude-launch.sh: runs INSIDE a restored tmux pane to resume the
# right Claude Code conversation. Identity is exact: $TMUX_PANE names this pane
# unambiguously, so it reads its own live pane key and looks up the matching
# session id in session_ids.json. This deliberately replaces resolving the
# session in the eval-time strategy, where the active-pane read is a race (and
# plain wrong with no client attached - every pane collapses onto the last
# active one). Flags to preserve (permission mode, model, ...) arrive as "$@".
#
# Degrades to `claude "$@" --continue` whenever exact identity can't be resolved
# (missing jq / session file / $TMUX_PANE, or an ambiguous cwd) - it never
# guesses a wrong resume, which was the multi-pane-same-cwd bug this replaces.
# CLAUDE_CONFIG_DIR (a ccp client account, invisible in argv) is restored so the
# pane keeps its billing account rather than reverting to the personal one.

SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

resume=""
config_dir=""

if command -v jq &>/dev/null && [ -f "$SESSION_FILE" ] && [ -n "${TMUX_PANE:-}" ]; then
	pane_key=$(tmux display-message -pt "$TMUX_PANE" '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
	if [ -n "$pane_key" ]; then
		resume=$(jq -r --arg k "$pane_key" '.panes[$k].claude // empty' "$SESSION_FILE" 2>/dev/null || true)
		config_dir=$(jq -r --arg k "$pane_key" '.panes[$k].claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null || true)
	fi

	# Safe cwd fallback on exact-key miss: use it only when EXACTLY one recorded
	# pane owns this cwd. 0 or >1 -> do not guess (the regression guard).
	if [ -z "$resume" ]; then
		local_matches=$(jq -r --arg dir "$PWD" '[.panes[] | select(.dir == $dir and (.claude // "") != "")] | length' "$SESSION_FILE" 2>/dev/null || echo 0)
		if [ "$local_matches" = "1" ]; then
			resume=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.claude // "") != "")) | .claude' "$SESSION_FILE" 2>/dev/null || true)
			config_dir=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.claude // "") != "")) | .claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null || true)
		fi
	fi
fi

if [ -n "$config_dir" ]; then
	export CLAUDE_CONFIG_DIR="$config_dir"
	# Refresh the restored profile's shared user config (settings + CLAUDE.md
	# memory) so a resumed ccp pane inherits the same statusLine/hooks/permissions
	# a fresh `ccp` launch materialises. Absolute path matches how the strategy
	# invokes this launcher; guarded like every other dep here (jq/session/pane),
	# and the helper itself fails open without jq/base.
	materialise="$HOME/.config/zsh/functions/claude-profile-materialise"
	[ -x "$materialise" ] && "$materialise" "$config_dir"
fi

if [ -n "$resume" ]; then
	exec claude "$@" --resume "$resume"
fi
exec claude "$@" --continue
