#!/bin/sh
# agent-popup.sh — fzf popup to jump to a tracked agent pane (phase 4). Lists
# every pane carrying @agent_state across all sessions, ranked by attention
# (blocked > done > working > idle), with a live pane-tail preview; Enter jumps.
#
#   agent-popup.sh            # pick (default): sweep, then list | fzf | jump
#   agent-popup.sh list       # emit ranked TAB rows (hidden pane_id first)
#   agent-popup.sh jump PANE  # switch to PANE and age its done → idle
#
# Split into subcommands so list/jump are unit-testable without driving fzf
# (which needs a real TTY). Bound to `prefix + A` via display-popup -E.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_STATE_SH=${AGENT_STATE_SH:-$SELF_DIR/agent-state.sh}
AGENT_SWEEP=${AGENT_SWEEP:-$SELF_DIR/agent-sweep.sh}

# list — one row per pane with agent state, ranked by attention. Hidden pane_id
# is field 1 (the jump key); fzf shows fields 2.. The glyph matches the status
# bar's catppuccin colours, emitted as truecolour ANSI via octal printf escapes
# for awk portability.
list() {
	tmux list-panes -a -F \
		"#{pane_id}	#{@agent_state}	#{@agent_kind}	#{session_name}:#{window_index}.#{pane_index}	#{window_name}	#{b:pane_current_path}" \
		2>/dev/null |
		awk -F '\t' '
		function rank(s) {
			if (s == "blocked") return 4
			if (s == "done")    return 3
			if (s == "working") return 2
			if (s == "idle")    return 1
			return 0
		}
		function glyph(s) {
			if (s == "blocked") return sprintf("\033[38;2;243;139;168m\342\227\217\033[0m")
			if (s == "working") return sprintf("\033[38;2;249;226;175m\342\227\217\033[0m")
			if (s == "done")    return sprintf("\033[38;2;137;180;250m\342\227\217\033[0m")
			if (s == "idle")    return sprintf("\033[38;2;166;227;161m\342\227\213\033[0m")
			return sprintf("\033[38;2;108;112;134m\302\267\033[0m")
		}
		BEGIN { OFS = "\t" }
		$2 != "" {
			n++
			pane[n] = $1; st[n] = $2; kind[n] = $3
			loc[n] = $4; wname[n] = $5; proj[n] = $6
			r[n] = rank($2)
		}
		END {
			# Stable insertion sort by rank desc (ties keep enumeration order).
			for (i = 1; i <= n; i++) idx[i] = i
			for (i = 2; i <= n; i++) {
				key = idx[i]; j = i - 1
				while (j >= 1 && r[idx[j]] < r[key]) { idx[j + 1] = idx[j]; j-- }
				idx[j + 1] = key
			}
			for (i = 1; i <= n; i++) {
				p = idx[i]
				print pane[p], glyph(st[p]), st[p], kind[p], proj[p], loc[p], wname[p]
			}
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

	_legend=$(printf '\033[38;2;243;139;168m\342\227\217\033[0m blocked  \033[38;2;249;226;175m\342\227\217\033[0m working  \033[38;2;137;180;250m\342\227\217\033[0m done  \033[38;2;166;227;161m\342\227\213\033[0m idle')

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
pick | "") pick ;;
*)
	echo "usage: agent-popup.sh [list|jump <pane_id>|pick]" >&2
	exit 2
	;;
esac
