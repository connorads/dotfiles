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

# is_viewing PANE_ACTIVE WINDOW_ACTIVE SESSION_ATTACHED — pure predicate: true
# when these three pane fields together mean a human is demonstrably looking at
# the pane (the active pane of the active window of an attached session). The
# single definition of "you are looking at it", shared by the `done` branch
# (agent-state.sh, seen-at-birth) and the phase-5 sweep (agent-sweep.sh, the
# viewed-done reconcile) so both age a finished agent identically. Missing/empty
# fields default to "not viewed" so a failed read never spuriously marks seen.
is_viewing() {
	[ "${1:-0}" = 1 ] && [ "${2:-0}" = 1 ] && [ "${3:-0}" != 0 ]
}

# should_ring PREV — true when this is a fresh entry into blocked (prev was
# anything else). Dedupes back-to-back blocked hooks so they don't double-bell.
should_ring() {
	[ "$1" != blocked ]
}

# stop_state COUNT — map a count of in-flight background tasks to the verb the
# Stop hook should forward: a positive count means work is still draining
# (working), zero means the turn is genuinely finished (done). Non-numeric or
# empty input collapses to done so a missing/garbled count never beats today's
# unconditional-done behaviour.
stop_state() {
	case ${1:-0} in
	0 | '' | *[!0-9]*) echo "done" ;;
	*) echo "working" ;;
	esac
}

# valid_agent_name NAME — true iff NAME matches [a-z][a-z0-9_-]{0,31}: a label
# that needs no quoting in a tmux format or a TAB-delimited fzf row. Empty,
# uppercase, leading digit/dash, and over-32-chars are rejected.
valid_agent_name() {
	case ${1:-} in '') return 1 ;; esac
	printf '%s' "$1" | grep -Eq '^[a-z][a-z0-9_-]{0,31}$'
}

# ring_bell PANE — write a BEL (\a) to every writable client TTY of the pane's
# session. Writes direct to the client TTY, bypassing tmux's monitor-bell so
# window_bell_flag stays clear — the red agent dot already covers the in-tmux
# signal; this only drives the outer terminal (kitty 🔔 + sound).
ring_bell() {
	_pane=$1
	_session=$(tmux display-message -p -t "$_pane" '#{session_name}' 2>/dev/null) || return 0
	[ -n "$_session" ] || return 0
	tmux list-clients -t "$_session" -F '#{client_tty}' 2>/dev/null |
		while IFS= read -r _tty; do
			[ -n "$_tty" ] && [ -w "$_tty" ] || continue
			printf '\a' >"$_tty" 2>/dev/null || true
		done
}

# agent_attrs STATE — "HEX CHAR" for STATE: the single source of truth for the
# state → glyph + colour mapping shared by the tab dots (@agent_dotfmt), the
# prefix+Alt+. menu, and the prefix+A popup. Shape encodes state alongside
# colour (reads on a colour clash and for colour-blind use); unknown → grey ·.
# agent-glyphs.bats fails if any renderer drifts from this. Same done)-as-pattern
# idiom as rank() above.
agent_attrs() {
	case $1 in
	blocked) echo "f38ba8 ◆" ;;
	working) echo "fab387 ◐" ;;
	done) echo "89b4fa ●" ;;
	idle) echo "a6e3a1 ○" ;;
	*) echo "6c7086 ·" ;;
	esac
}

# agent_hex STATE — 6 hex digits for STATE (for tmux #[fg=#...] consumers/tests).
agent_hex() {
	_attrs=$(agent_attrs "$1")
	echo "${_attrs% *}"
}

# agent_char STATE — bare UTF-8 glyph for STATE.
agent_char() {
	_attrs=$(agent_attrs "$1")
	echo "${_attrs#* }"
}

# agent_glyph STATE — STATE's glyph wrapped in an ANSI truecolour SGR
# (\033[38;2;R;G;Bm<char>\033[0m) for direct terminal output. Hex→RGB via POSIX
# arithmetic; hex is ASCII so cut -c is byte-safe.
agent_glyph() {
	_attrs=$(agent_attrs "$1")
	_hex=${_attrs% *}
	_char=${_attrs#* }
	_r=$((0x$(echo "$_hex" | cut -c1-2)))
	_g=$((0x$(echo "$_hex" | cut -c3-4)))
	_b=$((0x$(echo "$_hex" | cut -c5-6)))
	printf '\033[38;2;%d;%d;%dm%s\033[0m' "$_r" "$_g" "$_b" "$_char"
}
