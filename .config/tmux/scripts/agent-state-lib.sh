#!/bin/sh
# agent-state-lib.sh — shared rollup helpers for the agent-tracking scripts.
#
# Sourced (never executed) by agent-state.sh (phase 1) and agent-sweep.sh
# (phase 5) so both compute the per-window rollup identically. Function-locals
# are _underscore-prefixed and always assigned before use so `set -u` callers
# (agent-sweep.sh) are not clobbered or tripped.

# Attention ranking — the window dot shows the worst (highest) of its panes:
# blocked (needs you now) > done (finished, unseen) > working > idle.
rank() {
	case $1 in
	blocked) echo 4 ;;
	done) echo 3 ;;
	working) echo 2 ;;
	idle) echo 1 ;;
	*) echo 0 ;;
	esac
}

# roll_window WINDOW_ID — recompute @win_agent_state from the window's panes and
# set or unset it. No refresh-client: callers batch a single repaint.
roll_window() {
	_window=$1
	_best=
	_best_rank=0
	while IFS= read -r _s; do
		[ -n "$_s" ] || continue
		_r=$(rank "$_s")
		[ "$_r" -gt "$_best_rank" ] && {
			_best_rank=$_r
			_best=$_s
		}
	done <<EOF
$(tmux list-panes -t "$_window" -F '#{@agent_state}' 2>/dev/null)
EOF

	if [ -n "$_best" ]; then
		tmux set-option -w -t "$_window" @win_agent_state "$_best"
	else
		tmux set-option -wu -t "$_window" @win_agent_state 2>/dev/null || true
	fi
}
