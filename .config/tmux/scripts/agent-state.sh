#!/bin/sh
# agent-state.sh — hooks-first per-pane agent state + per-window rollup (phase 1).
#
# Each coding agent's native hook calls this with the resolved lifecycle state
# (working|blocked|done|idle); the tmux focus hooks (after-select-pane /
# session-window-changed / client-focus-in) call it with `seen` to age a finished
# agent once you look at it - client-focus-in covers regaining terminal focus on a
# pane you never navigationally left. It records state on the
# agent's pane, rolls the worst state across the window up to a window option the
# status bar renders, and repaints immediately so the dot never waits for
# status-interval.
#
#   agent-state.sh <working|blocked|done|unread|idle|clear|seen> [agent-kind]
#
# `unread` is the manual inverse of `seen` (forces done even on the focused
# window); the dot menu (prefix + Alt+.) drives it and the other states by hand.
#
# Pane: $AGENT_STATE_PANE overrides $TMUX_PANE (the focus hook passes a pane id;
# an agent's own hook inherits TMUX_PANE from the pane it runs in). Outside tmux,
# or once no agent panes remain, it is a quiet no-op.

set -u

state=${1:-}
kind=${2:-}
pane=${AGENT_STATE_PANE:-${TMUX_PANE:-}}

# Shared rollup helpers (rank + roll_window) live beside this script so phase 1
# (here) and phase 5 (agent-sweep.sh) share one implementation. agent-state.sh
# is always invoked by full path, so the sibling libs resolve off $0.
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=agent-state-lib.sh disable=SC1091
. "$SELF_DIR/agent-state-lib.sh"
# shellcheck source=agent-journal.sh disable=SC1091
. "$SELF_DIR/agent-journal.sh"

# Capture (and fully drain) hook stdin before any early exit, so the hook
# writer never sees EPIPE. The captured payload feeds journal_event below.
journal_capture_stdin

[ -n "$pane" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

window=$(tmux display-message -p -t "$pane" '#{window_id}' 2>/dev/null) || exit 0
[ -n "$window" ] || exit 0

# Every state-setting verb is journalled; `seen` only when it actually ages a
# pane (the focus hook fires it on every pane focus — no-ops are noise).
journal=1
case $state in
blocked)
	# Ring only on entry (not re-emits); see ring_bell.
	prev=$(tmux show-options -pqv -t "$pane" @agent_state 2>/dev/null)
	tmux set-option -p -t "$pane" @agent_state "$state"
	[ -n "$kind" ] && tmux set-option -p -t "$pane" @agent_kind "$kind"
	should_ring "$prev" && ring_bell "$pane"
	;;
working | idle)
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
	else
		journal=0
	fi
	;;
unread)
	# "Mark as unread": force done (finished, unseen) even on the active window
	# — the manual inverse of seen, driven by the dot menu. The blue dot then
	# persists after you leave; re-focusing the window ages it back to idle.
	tmux set-option -p -t "$pane" @agent_state "done"
	[ -n "$kind" ] && tmux set-option -p -t "$pane" @agent_kind "$kind"
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

[ "$journal" = 1 ] && journal_event "$state" "$kind" "$pane" "$window"

# Roll the worst pane state in this window up to the option the tabs render.
roll_window "$window"

tmux refresh-client -S 2>/dev/null || true
