#!/bin/sh
# agent-popup.sh — fzf popup to jump to a tracked agent pane (phase 4). Lists
# every pane carrying @agent_state across all sessions, ranked by attention
# (blocked > done > working > idle), with a live pane-tail preview; Enter jumps.
#
#   agent-popup.sh            # pick (default): sweep, then list | fzf | jump
#   agent-popup.sh list       # emit ranked TAB rows (hidden pane_id first)
#   agent-popup.sh jump PANE  # switch to PANE and age its done → idle
#   agent-popup.sh cycle WANTS [CUR]  # jump to next pane matching WANTS
#                                     # (CSV priority list, e.g. blocked,done)
#
# Split into subcommands so list/jump/cycle are unit-testable without driving
# fzf (which needs a real TTY). Bound to `prefix + A` (pick) and `prefix +
# Alt+a` (cycle blocked,done) via display-popup -E / run-shell.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SELF_DIR/agent-state-lib.sh" # agent_glyph: the canonical state → glyph mapping
# shellcheck disable=SC1091
. "$SELF_DIR/agent-cli-lib.sh" # agent_list_rows: the shared agent-pane enumerator
AGENT_STATE_SH=${AGENT_STATE_SH:-$SELF_DIR/agent-state.sh}
AGENT_SWEEP=${AGENT_SWEEP:-$SELF_DIR/agent-sweep.sh}

# list — one row per pane with agent state, ranked by attention. Hidden pane_id
# is field 1 (the jump key); fzf shows fields 2.. Enumeration lives in the
# shared agent_list_rows and ranking in agent_rank_sort (both
# agent-cli-lib.sh); this wrapper is display-only:
# it decorates each row with the state glyph and shortens cwd to its basename.
# The glyph (state colour + shape) is the single source of truth in
# agent-state-lib.sh: computed once per state in sh via agent_glyph, then passed
# into awk as truecolour-ANSI strings (awk can't source the lib; -v passes the
# finished bytes through verbatim).
list() {
	_g_blocked=$(agent_glyph blocked)
	_g_working=$(agent_glyph working)
	_g_done=$(agent_glyph 'done')
	_g_idle=$(agent_glyph idle)
	_g_unknown=$(agent_glyph unknown)
	agent_list_rows | agent_rank_sort |
		awk -F '\t' \
			-v g_blocked="$_g_blocked" -v g_working="$_g_working" \
			-v g_done="$_g_done" -v g_idle="$_g_idle" -v g_unknown="$_g_unknown" '
		# Selector over the glyphs agent_glyph computed in sh.
		function glyph(s) {
			if (s == "blocked") return g_blocked
			if (s == "working") return g_working
			if (s == "done")    return g_done
			if (s == "idle")    return g_idle
			return g_unknown
		}
		BEGIN { OFS = "\t" }
		# In: pane state kind name loc window_name cwd → out (fzf row):
		# pane glyph state kind name proj(basename cwd) loc window_name.
		{
			proj = $7
			sub(/.*\//, "", proj)
			print $1, glyph($2), $2, $3, $4, proj, $5, $6
		}'
}

# jump PANE — focus the agent's pane (switch session, window, then pane), then
# age its done → idle. The seen call is explicit because the focus hooks verifiably
# do not fire when switching into a session whose current window already shows the
# target (the common single-pane agent session); it is idempotent regardless.
jump() {
	_pane=${1:-}
	[ -n "$_pane" ] || {
		echo "usage: agent-popup.sh jump <pane_id>" >&2
		exit 2
	}
	tmux switch-client -t "$_pane" 2>/dev/null || true
	tmux select-window -t "$_pane" 2>/dev/null || true
	# select-pane is load-bearing: it still moves the active pane headlessly while
	# printing "no current client" and exiting non-zero. Tolerate ONLY that;
	# anything else is a real error.
	_err=$(tmux select-pane -t "$_pane" 2>&1) || case "$_err" in
	"" | *"no current client"*) : ;;
	*)
		printf '%s\n' "$_err" >&2
		exit 1
		;;
	esac
	AGENT_STATE_PANE="$_pane" sh "$AGENT_STATE_SH" seen
}

# _next_pane WANT CUR (rows `pane_id<TAB>state` on stdin) — echo the pane_id of
# the first row with state == WANT strictly after CUR in row order, wrapping
# past the end; empty if none. CUR absent or not in the list → start at the
# top. Pure (no tmux) so ordering/wrap are unit-testable from stdin.
_next_pane() {
	awk -F '\t' -v want="$1" -v cur="$2" '
		{ pane[NR] = $1; st[NR] = $2 }
		END {
			n = NR; if (n == 0) exit
			start = 0
			for (i = 1; i <= n; i++) if (pane[i] == cur) { start = i; break }
			for (k = 1; k <= n; k++) {
				i = ((start + k - 1) % n) + 1
				if (st[i] == want) { print pane[i]; exit }
			}
		}'
}

# cycle WANTS [CURRENT_PANE] — jump to the next agent pane whose @agent_state
# matches the first satisfiable state in WANTS, a CSV priority list (e.g.
# blocked,done: every blocked pane before any done one). Order within a state
# is positional (session → window index → pane index — agent_list_rows' native
# order; list()'s rank order would revisit the top-ranked pane forever),
# wrapping past CURRENT_PANE. Fallback policy lives in the caller's list, not
# here: bare `cycle blocked` jumps to blocked panes only. Reuses jump() for
# the move — including its seen ageing, which is correct here: cycling to a
# pane is viewing it.
cycle() {
	_wants=${1:-blocked}
	_cur=${2:-}
	_rows=$(agent_list_rows | cut -f1,2)
	[ -n "$_rows" ] || {
		tmux display-message "no active agents" 2>/dev/null || true
		return 0
	}

	_target=
	for _want in $(printf '%s' "$_wants" | tr ',' ' '); do
		_target=$(printf '%s\n' "$_rows" | _next_pane "$_want" "$_cur")
		[ -n "$_target" ] && break
	done

	if [ -n "$_target" ]; then
		jump "$_target"
	else
		tmux display-message "no $_wants agents" 2>/dev/null || true
	fi
}

# pick — sweep (keep the list fresh), then list | fzf | jump. Empty list prints a
# notice and returns (fzf on empty input would flash an empty popup).
pick() {
	[ -f "$AGENT_SWEEP" ] && sh "$AGENT_SWEEP" >/dev/null 2>&1 || true

	_rows=$(list)
	if [ -z "$_rows" ]; then
		printf 'No active agents\n'
		sleep 0.8
		return 0
	fi

	_legend=$(printf '%s blocked  %s working  %s done  %s idle' \
		"$(agent_glyph blocked)" "$(agent_glyph working)" \
		"$(agent_glyph 'done')" "$(agent_glyph idle)")

	_choice=$(printf '%s\n' "$_rows" | fzf \
		--ansi --reverse --no-multi --info=hidden \
		--delimiter='\t' --with-nth=2.. \
		--prompt='jump › ' \
		--header="$_legend" \
		--preview 'tmux capture-pane -ep -t {1}' \
		--preview-window=right:60%:wrap) || return 0

	_target=$(printf '%s' "$_choice" | cut -f1)
	[ -n "$_target" ] && jump "$_target"
}

case "${1:-}" in
list) list ;;
jump)
	shift
	jump "${1:-}"
	;;
cycle)
	shift
	cycle "$@"
	;;
pick | "") pick ;;
*)
	echo "usage: agent-popup.sh [list|jump <pane_id>|cycle <state[,state]> [cur_pane]|pick]" >&2
	exit 2
	;;
esac
