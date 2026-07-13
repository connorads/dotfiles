#!/bin/sh
# agent-sweep.sh — the phase-5 reconcile net behind the hooks-first model. Two jobs:
#   (1) clear stale agent dots left by agents that died without a clean done/clear
#       (SIGKILL, crash, pane closed abruptly);
#   (2) age a `done` dot you are currently looking at to idle — a backstop for the
#       focus hooks' `seen`, which the focus events miss under concurrent-agent
#       churn (you watch one agent while another finishes, then return to it
#       without a fresh select-pane/window-changed transition).
#
# Liveness signal: a running agent stays its pane's foreground process-group
# leader, so #{pane_current_command} reads as the runtime (claude/codex-…/node)
# even while it runs a piped Bash tool. A plain *shell* foreground therefore
# means the agent exited — only then is the dot cleared. Non-shell foregrounds
# (vim, sleep, other TUIs) are left alone: the sweep only ever fails to clear,
# never wrongly clears.
#
#   agent-sweep.sh            # one-shot sweep (default)
#   agent-sweep.sh daemon     # single per-server background loop (≤POLL clearing)
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

# sweep_once — reconcile every dot in one pass: read all panes once, clear panes
# whose agent died (shell foreground), age a `done` dot you are currently looking
# at to idle, and recompute the rollup for every affected window plus any window
# still showing a stale @win_agent_state.
sweep_once() {
	command -v tmux >/dev/null 2>&1 || return 0
	tmux list-sessions >/dev/null 2>&1 || return 0

	_rows=$(tmux list-panes -a -F \
		"#{window_id}	#{pane_id}	#{@agent_state}	#{pane_current_command}	#{@win_agent_state}	#{pane_active}	#{window_active}	#{session_attached}" \
		2>/dev/null) || return 0

	_tab=$(printf '\t')
	_panes=
	_seen=
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
		_line=${_line#*"$_tab"}
		_wstate=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_pactive=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_wactive=${_line%%"$_tab"*}
		_sattached=${_line#*"$_tab"}

		if [ -n "$_astate" ]; then
			case "$SHELLS" in
			*" $_cmd "*)
				# Foreground is a bare shell → the agent is gone. Clear it and
				# re-roll its window.
				_panes="$_panes$_pane
"
				_windows="$_windows$_win
"
				;;
			*)
				# Agent still alive: a `done` dot on a pane you are currently
				# looking at (is_viewing: active pane, active window, ≥1 attached
				# client) is seen — age it to idle. Backstop for both the `done`
				# branch's seen-at-birth and the focus hooks' `seen`.
				if [ "$_astate" = "done" ] &&
					is_viewing "$_pactive" "$_wactive" "$_sattached"; then
					_seen="$_seen$_pane
"
					_windows="$_windows$_win
"
				fi
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

	[ -n "$_panes$_seen$_windows" ] || return 0

	printf '%s' "$_panes" | while IFS= read -r _p; do
		[ -n "$_p" ] || continue
		tmux set-option -pu -t "$_p" @agent_state 2>/dev/null || true
		tmux set-option -pu -t "$_p" @agent_kind 2>/dev/null || true
	done

	printf '%s' "$_seen" | while IFS= read -r _p; do
		[ -n "$_p" ] || continue
		tmux set-option -p -t "$_p" @agent_state idle 2>/dev/null || true
	done

	printf '%s' "$_windows" | sort -u | while IFS= read -r _w; do
		[ -n "$_w" ] || continue
		roll_window "$_w"
	done

	tmux refresh-client -S 2>/dev/null || true
}

# _is_sweep PID — true if PID is an agent-sweep process (guards the pidfile
# against PID reuse). /proc on Linux, ps fallback on macOS (no /proc).
_is_sweep() {
	if [ -r "/proc/$1/cmdline" ]; then
		tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null | grep -q agent-sweep
	else
		ps -p "$1" -o command= 2>/dev/null | grep -q agent-sweep
	fi
}

# daemon — one background loop per tmux server. Clears stale dots every POLL
# while a client is attached; self-terminates when the server dies.
daemon() {
	command -v tmux >/dev/null 2>&1 || return 0
	tmux list-sessions >/dev/null 2>&1 || return 0

	_state_dir=${AGENT_SWEEP_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-sweep}
	_server_pid=$(tmux display-message -p '#{pid}' 2>/dev/null)
	[ -n "$_server_pid" ] || return 0
	_pidfile="$_state_dir/server-$_server_pid.pid"

	# Single-instance guard: a live agent-sweep daemon already owns this server.
	if [ -f "$_pidfile" ]; then
		_old=$(cat "$_pidfile" 2>/dev/null || true)
		if [ -n "$_old" ] && kill -0 "$_old" 2>/dev/null && _is_sweep "$_old"; then
			return 0
		fi
	fi

	# Own a process group so teardown can signal the whole tree. setsid is absent
	# on macOS — fall back to running in place (run-shell -b already detached us),
	# exactly as claude-watcher does.
	if [ -z "${AGENT_SWEEP_SETSID:-}" ] && command -v setsid >/dev/null 2>&1; then
		AGENT_SWEEP_SETSID=1 exec setsid "$SELF_DIR/$(basename -- "$0")" daemon
	fi

	mkdir -p "$_state_dir"
	printf '%s\n' "$$" >"$_pidfile"
	# EXIT cleans the pidfile; INT/TERM must *exit* (a bare signal trap would run
	# then resume the loop) so the EXIT trap fires.
	trap 'rm -f "$_pidfile" 2>/dev/null' EXIT
	trap 'exit 143' TERM
	trap 'exit 130' INT

	while :; do
		sleep "${AGENT_SWEEP_POLL:-10}"
		tmux list-sessions >/dev/null 2>&1 || break
		sweep_once
	done
}

case "${1:-}" in
"" | sweep | sweep_once) sweep_once ;;
daemon) daemon ;;
*)
	printf 'usage: %s [sweep|daemon]\n' "$(basename -- "$0")" >&2
	exit 2
	;;
esac
