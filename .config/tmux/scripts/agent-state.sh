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
#   agent-state.sh <working|blocked|done|unread|idle|clear|seen|name|unname> [arg]
#
# `unread` is the manual inverse of `seen` (forces done even on the focused
# window); the dot menu (prefix + Alt+.) drives it and the other states by hand.
# `name`/`unname` set/drop the pane's @agent_name label (for `name` the second
# positional is the label, validated against valid_agent_name); the name rides
# @agent_state's lifecycle — `clear` and the sweep's death-clear drop it too.
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
	# Seen-at-birth: if you are already viewing this pane when it finishes → go
	# straight to idle; otherwise it is done (finished, unseen) until you focus it.
	# "Viewing" is the sweep's gate (is_viewing): the active pane of the active
	# window of an attached session - not window_active alone, so a finish on a
	# detached or background session correctly stays unread. The focus hooks' seen
	# and the phase-5 sweep are the backstops when this races (e.g. window_active
	# momentarily reads 0) or when you were not looking at finish time.
	pflags=$(tmux display-message -p -t "$pane" \
		'#{pane_active} #{window_active} #{session_attached}' 2>/dev/null)
	# shellcheck disable=SC2086  # deliberate word-split of the three flag fields
	if is_viewing ${pflags:-0 0 0}; then
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
	tmux set-option -pu -t "$pane" @agent_name 2>/dev/null || true
	;;
name)
	agent_name=${2:-}
	if ! valid_agent_name "$agent_name"; then
		echo "agent-state.sh: invalid agent name '$agent_name'" >&2
		exit 2
	fi
	# @agent_name rides @agent_state's lifecycle (dropped by clear + the sweep's
	# @agent_state-gated death-clear), so refuse to name a stateless pane — an
	# orphan name would never be swept.
	if [ -z "$(tmux show-options -pqv -t "$pane" @agent_state 2>/dev/null)" ]; then
		echo "agent-state.sh: pane has no agent state; nothing to name" >&2
		exit 2
	fi
	tmux set-option -p -t "$pane" @agent_name "$agent_name"
	# Not journalled: the journal schema has state/kind but no name field.
	journal=0
	;;
unname)
	tmux set-option -pu -t "$pane" @agent_name 2>/dev/null || true
	journal=0
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
