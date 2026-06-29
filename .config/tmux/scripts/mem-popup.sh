#!/bin/sh
# mem-popup.sh — prefix+M-m popup: the on-demand, expensive view of memory
# pressure. Progressive disclosure from the status segment: the gauge says
# "something is hot", this says "which app". Three sections:
#
#   1. Header  — state word + pressure, swap used/total, wired + compressed-
#                physical RAM (cheap sysctl + vm_stat).
#   2. Top apps — top processes by RSS (instant), then phys_footprint sampled in
#                parallel and grouped by app. footprint is ~88 ms each, so cap
#                the set and xargs -P keeps the popup well under half a second.
#   3. Agents  — tmux panes carrying @agent_state, labelled by window name +
#                the shared agent dot (recognition over recall), each sized by
#                the heaviest process in its tree.
#
# CAVEAT shown in-popup: per-app footprint sums OVER-count shared pages (a
# Chrome sum can exceed physical RAM), so totals are approximate (≈) — the
# *ranking* is what's reliable. Footprint is the jetsam metric, not RSS.
#
# Subcommand `_one PID` (used by xargs) emits "<mb>\t<app>" for one pid so the
# footprint fan-out can run as separate processes without re-sourcing tricks.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=/dev/null
. "$SELF_DIR/mem-lib.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/agent-state-lib.sh" # agent_glyph: shared state → glyph mapping

TOP_PROCS=${MEM_TOP_PROCS:-15} # footprint sample size (cost ~88 ms each)
TOP_APPS=${MEM_TOP_APPS:-8}    # app rows rendered
BAR_WIDTH=12

# ansi HEX TEXT — TEXT wrapped in a truecolour SGR (same hex→RGB trick as
# agent_glyph). Hex is ASCII so cut -c is byte-safe.
ansi() {
	_hex=$1
	_r=$((0x$(echo "$_hex" | cut -c1-2)))
	_g=$((0x$(echo "$_hex" | cut -c3-4)))
	_b=$((0x$(echo "$_hex" | cut -c5-6)))
	printf '\033[38;2;%d;%d;%dm%s\033[0m' "$_r" "$_g" "$_b" "$2"
}

# emit_one PID — "<footprint_mb>\t<app>" for one pid (skips zero/gone procs).
# Invoked as `mem-popup.sh _one PID` by the xargs fan-out.
emit_one() {
	_pid=$1
	_mb=$(mem_footprint_mb "$_pid")
	[ "$_mb" -gt 0 ] 2>/dev/null || return 0
	_cmd=$(ps -p "$_pid" -o command= 2>/dev/null) || return 0
	[ -n "$_cmd" ] || return 0
	printf '%s\t%s\n' "$_mb" "$(mem_app_name "$_cmd")"
}

# vm_stat_mb FIELD — MB for a vm_stat page-count line (pages × page size).
# Page size is read from vm_stat's own header so it tracks 4K vs 16K hosts.
vm_stat_mb() {
	vm_stat 2>/dev/null | awk -v field="$1" '
		/page size of/ { for (i = 1; i <= NF; i++) if ($i == "of") { ps = $(i + 1); break } }
		$0 ~ field {
			n = $NF; gsub(/[^0-9]/, "", n)
			printf "%d", n * ps / 1048576
			found = 1; exit
		}
		END { if (!found) print 0 }'
}

# heaviest_pid_mb ROOT — footprint MB of the heaviest process in ROOT's tree
# (the shell pane_pid itself is excluded; the agent is a child). 0 if none.
heaviest_pid_mb() {
	_best=$(ps -axo pid=,ppid=,rss= | awk -v root="$1" '
		{ ppid[$1] = $2; rss[$1] = $3 }
		END {
			# `in` membership (not desc[ppid[p]]) is load-bearing: indexing
			# auto-vivifies an empty-string key that bridges to launchd(1) and
			# marks every process as a descendant. `in` tests without creating.
			desc[root] = 1; changed = 1
			while (changed) {
				changed = 0
				for (p in ppid) if (!(p in desc) && (ppid[p] in desc)) { desc[p] = 1; changed = 1 }
			}
			bestpid = ""; bestrss = -1
			for (p in desc) {
				if (p == root) continue
				if (rss[p] > bestrss) { bestrss = rss[p]; bestpid = p }
			}
			print bestpid
		}')
	[ -n "$_best" ] || {
		echo 0
		return
	}
	mem_footprint_mb "$_best"
}

render() {
	_state=$(mem_state)
	_colour=$(mem_state_colour "$_state")
	_glyph=$(mem_state_glyph "$_state")
	_level=$(mem_pressure_level)

	# Swap total token ("4096.00M" / "8.00G") → integer MB → human, matching
	# the used figure's formatting.
	_swap_total_mb=$(sysctl -n vm.swapusage 2>/dev/null | awk '{
		for (i = 1; i <= NF; i++) if ($i == "total") { v = $(i + 2); break }
		u = substr(v, length(v), 1); n = substr(v, 1, length(v) - 1) + 0
		if (u == "G") n = n * 1024; else if (u == "K") n = n / 1024
		printf "%d", n }')
	_swap_total=$(mem_human_mb "${_swap_total_mb:-0}")
	_swap_used=$(mem_swap_human)
	_wired=$(mem_human_mb "$(vm_stat_mb 'Pages wired down')")
	_compressed=$(mem_human_mb "$(vm_stat_mb 'Pages occupied by compressor')")

	printf '%s %s  %s   pressure %s/4\n' \
		"$(ansi "$_colour" "$_glyph")" \
		"$(ansi "$_colour" "$_state")" \
		"Memory" "$_level"
	printf '  Swap   %s used / %s\n' "$_swap_used" "${_swap_total:-?}"
	printf '  Wired  %s    Compressed %s\n' "$_wired" "$_compressed"
	printf '\n'

	# Top apps: instant RSS ranking → parallel footprint → group by app.
	_grouped=$(ps -axo pid=,rss= |
		sort -k2 -nr | head -n "$TOP_PROCS" | awk '{ print $1 }' |
		xargs -P 8 -n 1 "$0" _one 2>/dev/null | mem_group_apps)

	printf '%s\n' "$(ansi f9e2af 'Top apps')  ≈ footprint (sums over-count shared pages; ranking is reliable)"
	if [ -z "$_grouped" ]; then
		printf '  (no footprint data)\n'
	else
		_max=$(printf '%s\n' "$_grouped" | head -n1 | cut -f1)
		printf '%s\n' "$_grouped" | head -n "$TOP_APPS" | while IFS="$(printf '\t')" read -r _mb _cnt _app; do
			printf '  %-22s %s ≈%-7s %s\n' \
				"$_app" "$(mem_bar "$_mb" "$_max" "$BAR_WIDTH")" \
				"$(mem_human_mb "$_mb")" "($_cnt)"
		done
	fi
	printf '\n'

	# Agents: tmux panes with @agent_state, sized by heaviest tree process.
	_agents=$(tmux list-panes -a -F \
		'#{@agent_state}	#{window_name}	#{pane_pid}' 2>/dev/null |
		awk -F '\t' '$1 != ""')
	if [ -n "$_agents" ]; then
		printf '%s\n' "$(ansi 89b4fa 'Agents')"
		printf '%s\n' "$_agents" | while IFS="$(printf '\t')" read -r _st _win _ppid; do
			_amb=$(heaviest_pid_mb "$_ppid")
			printf '  %s %-22s %s\n' \
				"$(agent_glyph "$_st")" "$_win" "$(mem_human_mb "$_amb")"
		done
		printf '\n'
	fi

	printf '%s  %s  %s\n' \
		'[k] kill picker' '[r] refresh' '[q] close'
}

# k → hand off to pclose's own fzf (it shows MEM%); it cannot be pre-targeted
# with a pid (opens its own picker) — a noted future extension.
case "${1:-}" in
_one)
	emit_one "${2:-}"
	exit 0
	;;
esac

while :; do
	clear 2>/dev/null || printf '\033[H\033[2J'
	render
	# Read a single keypress; tolerate non-TTY (degrade to render-once).
	if [ -t 0 ]; then
		_old=$(stty -g 2>/dev/null || true)
		stty raw -echo min 1 time 0 2>/dev/null || true
		_key=$(dd bs=1 count=1 2>/dev/null)
		[ -n "$_old" ] && stty "$_old" 2>/dev/null || true
	else
		break
	fi
	case "$_key" in
	r | R) continue ;;
	k | K)
		[ -n "$_old" ] && stty "$_old" 2>/dev/null || true
		zsh -ic "pclose" || true
		;;
	*) break ;;
	esac
done
