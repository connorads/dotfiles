#!/bin/sh
# agent-sweep.sh — clear stale agent dots left by agents that died without a
# clean done/clear (SIGKILL, crash, pane closed abruptly). The phase-5 liveness
# net behind the hooks-first model.
#
# Liveness signal: a running agent stays its pane's foreground process-group
# leader, so #{pane_current_command} reads as the runtime (claude/codex-…/node)
# even while it runs a piped Bash tool. A plain *shell* foreground therefore
# means the agent exited — only then is the dot cleared. Non-shell foregrounds
# (vim, sleep, other TUIs) are left alone: the sweep only ever fails to clear,
# never wrongly clears.
#
#   agent-sweep.sh            # one-shot sweep (default)
#
# Quiet no-op when there is no tmux or no running server.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=agent-state-lib.sh disable=SC1091
. "$SELF_DIR/agent-state-lib.sh"

# Shells whose foreground presence means the agent that lived in this pane has
# exited. Space-padded for whole-word `case` matching.
SHELLS=" zsh bash sh fish dash ash "

# sweep_once — clear every stale dot in one pass: read all panes once, clear
# panes whose agent died (shell foreground), and recompute the rollup for every
# affected window plus any window still showing a stale @win_agent_state.
sweep_once() {
	command -v tmux >/dev/null 2>&1 || return 0
	tmux list-sessions >/dev/null 2>&1 || return 0

	_rows=$(tmux list-panes -a -F \
		"#{window_id}	#{pane_id}	#{@agent_state}	#{pane_current_command}	#{@win_agent_state}" \
		2>/dev/null) || return 0

	_tab=$(printf '\t')
	_panes=
	_windows=
	# Manual tab-split (not IFS read): tab is IFS-whitespace, so consecutive tabs
	# from an empty @agent_state field would collapse and misalign the columns.
	while IFS= read -r _line; do
		[ -n "$_line" ] || continue
		_win=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_pane=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_astate=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_cmd=${_line%%"$_tab"*}
		_wstate=${_line#*"$_tab"}

		# A pane carrying agent state whose foreground is a bare shell → the agent
		# is gone. Clear it and re-roll its window.
		if [ -n "$_astate" ]; then
			case "$SHELLS" in
			*" $_cmd "*)
				_panes="$_panes$_pane
"
				_windows="$_windows$_win
"
				;;
			esac
		fi
		# Re-roll any window still showing a dot too: hard-closing the worst pane
		# drops its own @agent_state but leaves the rollup stale with no pane to
		# target, so the recompute has to be driven from the window.
		[ -n "$_wstate" ] && _windows="$_windows$_win
"
	done <<EOF
$_rows
EOF

	[ -n "$_panes$_windows" ] || return 0

	printf '%s' "$_panes" | while IFS= read -r _p; do
		[ -n "$_p" ] || continue
		tmux set-option -pu -t "$_p" @agent_state 2>/dev/null || true
		tmux set-option -pu -t "$_p" @agent_kind 2>/dev/null || true
	done

	printf '%s' "$_windows" | sort -u | while IFS= read -r _w; do
		[ -n "$_w" ] || continue
		roll_window "$_w"
	done

	tmux refresh-client -S 2>/dev/null || true
}

case "${1:-}" in
"" | sweep | sweep_once) sweep_once ;;
*)
	printf 'usage: %s [sweep]\n' "$(basename -- "$0")" >&2
	exit 2
	;;
esac
