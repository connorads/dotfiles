#!/bin/sh
# agent-state.sh — hooks-first per-pane agent state + per-window rollup (phase 1).
#
# Each coding agent's native hook calls this with the resolved lifecycle state
# (working|blocked|done|idle); the tmux `pane-focus-in` hook calls it with
# `seen` to age a finished agent once you look at it. It records state on the
# agent's pane, rolls the worst state across the window up to a window option the
# status bar renders, and repaints immediately so the dot never waits for
# status-interval.
#
#   agent-state.sh <working|blocked|done|idle|clear|seen> [agent-kind]
#
# Pane: $AGENT_STATE_PANE overrides $TMUX_PANE (the focus hook passes a pane id;
# an agent's own hook inherits TMUX_PANE from the pane it runs in). Outside tmux,
# or once no agent panes remain, it is a quiet no-op.

set -u

state=${1:-}
kind=${2:-}
pane=${AGENT_STATE_PANE:-${TMUX_PANE:-}}

[ -n "$pane" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

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

window=$(tmux display-message -p -t "$pane" '#{window_id}' 2>/dev/null) || exit 0
[ -n "$window" ] || exit 0

case $state in
working | blocked | idle)
	tmux set-option -p -t "$pane" @agent_state "$state"
	[ -n "$kind" ] && tmux set-option -p -t "$pane" @agent_kind "$kind"
	;;
done)
	# "Seen" if you are already on this window when it finishes → straight to
	# idle; otherwise it is done (finished, unseen) until you focus the window.
	if [ "$(tmux display-message -p -t "$pane" '#{window_active}' 2>/dev/null)" = 1 ]; then
		tmux set-option -p -t "$pane" @agent_state idle
	else
		tmux set-option -p -t "$pane" @agent_state "done"
	fi
	[ -n "$kind" ] && tmux set-option -p -t "$pane" @agent_kind "$kind"
	;;
seen)
	# Focusing a finished pane ages done → idle; nothing else changes.
	if [ "$(tmux show-options -pqv -t "$pane" @agent_state 2>/dev/null)" = "done" ]; then
		tmux set-option -p -t "$pane" @agent_state idle
	fi
	;;
clear)
	tmux set-option -pu -t "$pane" @agent_state 2>/dev/null || true
	tmux set-option -pu -t "$pane" @agent_kind 2>/dev/null || true
	;;
*)
	echo "agent-state.sh: unknown state '$state'" >&2
	exit 2
	;;
esac

# Roll the worst pane state in this window up to the option the tabs render.
best=
best_rank=0
while IFS= read -r s; do
	[ -n "$s" ] || continue
	r=$(rank "$s")
	[ "$r" -gt "$best_rank" ] && {
		best_rank=$r
		best=$s
	}
done <<EOF
$(tmux list-panes -t "$window" -F '#{@agent_state}' 2>/dev/null)
EOF

if [ -n "$best" ]; then
	tmux set-option -w -t "$window" @win_agent_state "$best"
else
	tmux set-option -wu -t "$window" @win_agent_state 2>/dev/null || true
fi

tmux refresh-client -S 2>/dev/null || true
