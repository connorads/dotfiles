#!/bin/sh
# mem-popup.sh — memory-pressure triage: a bounded live summary plus paged
# sampled-app and all-agent details. Footprint is expensive, so app ranking is
# sampled from the largest RSS processes rather than pretending to be complete.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_HIBERNATE_SH=${AGENT_HIBERNATE_SH:-$SELF_DIR/agent-hibernate.sh}
# shellcheck source=/dev/null
. "$SELF_DIR/mem-lib.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/agent-state-lib.sh"

TOP_PROCS=${MEM_TOP_PROCS:-15}
DETAIL_TOP_PROCS=${MEM_DETAIL_TOP_PROCS:-50}
TOP_APPS=${MEM_TOP_APPS:-5}
TOP_AGENTS=${MEM_TOP_AGENTS:-3}
BAR_WIDTH=12     # app rows: magnitude against the top app
ARM_BAR_WIDTH=20 # header arms: 60/80 and 70/85 land on whole cells at 20
CURRENT_ROWS=""
CURRENT_GROUPED=""
CURRENT_HIB_ROWS=""

ansi() {
	_hex=$1
	_r=$((0x$(echo "$_hex" | cut -c1-2)))
	_g=$((0x$(echo "$_hex" | cut -c3-4)))
	_b=$((0x$(echo "$_hex" | cut -c5-6)))
	printf '\033[38;2;%d;%d;%dm%s\033[0m' "$_r" "$_g" "$_b" "$2"
}

# emit_one PID — "<footprint_mb>\t<app>\t<pid>\t<command>".
emit_one() {
	_pid=$1
	_mb=$(mem_footprint_mb "$_pid")
	[ "$_mb" -gt 0 ] 2>/dev/null || return 0
	_cmd=$(ps -p "$_pid" -o command= 2>/dev/null) || return 0
	[ -n "$_cmd" ] || return 0
	printf '%s\t%s\t%s\t%s\n' "$_mb" "$(mem_app_name "$_cmd")" "$_pid" "$_cmd"
}

# snapshot_rows LIMIT — candidates come from cheap RSS, then footprint is
# measured in parallel. This bounds latency while retaining a useful culprit set.
snapshot_rows() {
	_limit=$1
	ps -axo pid=,rss= |
		sort -k2 -nr | head -n "$_limit" | awk '{ print $1 }' |
		xargs -P 8 -n 1 "$0" _one 2>/dev/null
}

group_rows() {
	awk -F '\t' 'NF >= 3 { print $1 "\t" $2 }' | mem_group_apps
}

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

agent_rows() {
	tmux list-panes -a -F '#{@agent_state}	#{window_name}	#{pane_pid}' 2>/dev/null |
		awk -F '\t' '$1 != ""'
}

hibernate_apply() {
	_count=$#
	[ "$_count" -gt 0 ] || return 0
	if [ "$_count" -gt 1 ]; then
		printf 'Hibernate %s agent panes? [y/N] ' "$_count"
		IFS= read -r _answer || _answer=""
		case "$_answer" in y | Y | yes | YES) ;; *)
			printf 'Cancelled.\n'
			return 0
			;;
		esac
	fi
	_ok=0 _refused=0 _failed=0
	for _pane in "$@"; do
		"$AGENT_HIBERNATE_SH" hibernate "$_pane" >/dev/null 2>&1
		_rc=$?
		case "$_rc" in
		0) _ok=$((_ok + 1)) ;;
		6) _refused=$((_refused + 1)) ;;
		*) _failed=$((_failed + 1)) ;;
		esac
	done
	printf '%s hibernated, %s refused, %s failed\n' "$_ok" "$_refused" "$_failed"
}

# choose_agents_to_hibernate — the `h` list, read from the rows render() already
# gathered so the picker opens at once rather than re-footprinting every pane.
choose_agents_to_hibernate() {
	_rows=$CURRENT_HIB_ROWS
	if [ -z "$_rows" ]; then
		printf 'No idle or done Claude or Codex panes are safe to hibernate.\n'
		pause_result
		return 0
	fi
	_selected=$(printf '%s\n' "$_rows" | fzf --multi --reverse \
		--delimiter="$(printf '\t')" --with-nth=3,2,4,5 \
		--header='Tab selects multiple · Enter hibernates' \
		--prompt='hibernate › ' 2>/dev/null) || return 0
	_panes=$(printf '%s\n' "$_selected" | cut -f1)
	# Pane ids contain no whitespace; splitting turns the selected lines into argv.
	# shellcheck disable=SC2086
	set -- $_panes
	hibernate_apply "$@"
	pause_result
}

# gib_of COUNT BYTES_EACH — COUNT units of BYTES_EACH as GiB, one decimal.
gib_of() {
	awk -v n="${1:-0}" -v b="${2:-0}" 'BEGIN { printf "%.1f", n * b / 1073741824 }'
}

# render_arm GLYPH LABEL PCT BUSY CRIT USED LIMIT — one compressor arm: its
# own state glyph and figure (coloured by the arm's standing, not the overall
# state), a bar with a tick at each line, the distance to the next line, and
# the logical size. POSIX printf pads by bytes, so only ASCII fields take a
# width; the coloured pieces are pre-rendered and inserted with a bare %s.
# Every lib-derived value lands in its own _a-name first: the lib assigns
# `_state` and friends globally, so a nested call would clobber the caller's.
render_arm() {
	_a_state=$(mem_arm_state "$3" "$4" "$5")
	_a_colour=$(mem_state_colour "$_a_state")
	_a_glyph=$(ansi "$_a_colour" "$(mem_state_glyph "$_a_state")")
	_a_pct=$(ansi "$_a_colour" "$(printf '%3s%%' "$3")")
	_a_bar=$(mem_bar_marked "$3" "$ARM_BAR_WIDTH" "$4" "$5")
	_a_gap=$(mem_arm_gap "$3" "$4" "$5")
	printf '  %s %-6s %s  %s  %-11s  %s of %s GiB\n' \
		"$_a_glyph" "$2" "$_a_bar" "$_a_pct" "$_a_gap" "$6" "$7"
}

# render_action — the lever: the heaviest idle/done agent pane `h` would stop
# first, from the rows render() gathered, else the `k` fallback. Fields by
# `cut`, never `IFS=tab read`: the label can be empty, and read would then
# shift every later field left.
render_action() {
	_first=$(printf '%s\n' "$CURRENT_HIB_ROWS" | head -n1)
	if [ -z "$_first" ]; then
		printf '  Action   no idle or done agent pane; [k] ends a process (frees both arms)\n'
		return
	fi
	_h_label=$(printf '%s\n' "$_first" | cut -f3 | cut -c1-24)
	[ -n "$_h_label" ] || _h_label=$(printf '%s\n' "$_first" | cut -f1)
	printf '  Action   [h] hibernate %s (%s, %s) frees its pages from both arms\n' \
		"$_h_label" "$(printf '%s\n' "$_first" | cut -f4)" \
		"$(mem_human_mb "$(printf '%s\n' "$_first" | cut -f2)")"
}

# render_header — state line (with the pressure level and marker), then the
# compressor's two ceilings via render_arm with a gloss naming what each holds
# and what lowers it, the pages-per-segment ratio against the limits' own (so
# which arm fills first is a sentence, not a rule to remember), and the action.
# One gather feeds state and figures alike, so the header never shows a state
# its own bars contradict. Wired sits on the state line; swap sits on the
# segments gloss because a swapout releases a segment and never a slot.
render_header() {
	# shellcheck disable=SC2046  # deliberate split of "PRESSURE pages limit segs seglimit"
	set -- $(mem_pressure_level) $(mem_compressor_raw)
	_level=$1
	_pages=$2
	_plimit=$3
	_segs=$4
	_slimit=$5
	_slots_pct=$(mem_pct_from "$_pages" "$_plimit")
	_segs_pct=$(mem_pct_from "$_segs" "$_slimit")
	_state=$(mem_state_from "$_level" "$_slots_pct" "$_segs_pct")
	_pgsz=$(sysctl -n hw.pagesize 2>/dev/null) || _pgsz=""
	_segb=$(sysctl -n vm.compressor_segment_buffer_size 2>/dev/null) || _segb=""
	case $_pgsz in '' | *[!0-9]*) _pgsz=16384 ;; esac
	case $_segb in '' | *[!0-9]*) _segb=65536 ;; esac
	_auto=$(tmux show-options -gqv @agent_auto_hibernate 2>/dev/null || true)
	case $_auto in off | observe | on) ;; *) _auto=observe ;; esac
	_colour=$(mem_state_colour "$_state")
	_glyph=$(mem_state_glyph "$_state")
	_swap_total_mb=$(sysctl -n vm.swapusage 2>/dev/null | awk '{
		for (i = 1; i <= NF; i++) if ($i == "total") { v = $(i + 2); break }
		u = substr(v, length(v), 1); n = substr(v, 1, length(v) - 1) + 0
		if (u == "G") n = n * 1024; else if (u == "K") n = n / 1024
		printf "%d", n }')
	case "$_level" in
	4) _marker=$(ansi f38ba8 ' ▲ critical') ;;
	2) _marker=$(ansi f9e2af ' ▲ warn') ;;
	*) _marker="" ;;
	esac
	printf '%s %s  Memory   pressure %s/4%s   wired %s\n' \
		"$(ansi "$_colour" "$_glyph")" "$(ansi "$_colour" "$_state")" "$_level" "$_marker" \
		"$(mem_human_mb "$(vm_stat_mb 'Pages wired down')")"
	render_arm ⬡ Slots "$_slots_pct" "$MEM_BUSY_SLOTS_PCT" "$MEM_CRITICAL_SLOTS_PCT" \
		"$(gib_of "$_pages" "$_pgsz")" "$(gib_of "$_plimit" "$_pgsz")"
	printf '           pages held; fall only when the owning process frees or exits\n'
	render_arm ⬡ Segs "$_segs_pct" "$MEM_BUSY_SEGS_PCT" "$MEM_CRITICAL_SEGS_PCT" \
		"$(gib_of "$_segs" "$_segb")" "$(gib_of "$_slimit" "$_segb")"
	printf '           storage held; also falls by swapout   swap %s of %s\n' \
		"$(mem_swap_human)" "$(mem_human_mb "${_swap_total_mb:-0}")"
	awk -v r="$(mem_ratio_from "$_pages" "$_segs")" -v l="$(mem_ratio_from "$_plimit" "$_slimit")" \
		'BEGIN { printf "  Ratio    %s pages per segment (limits %s): %s fill first\n", r, l, (r > l ? "slots" : "segments") }'
	render_action
	printf '\n  Agent auto-hibernate  %s\n\n' "$_auto"
}

render_apps() {
	_rows=$1
	_limit=$2
	_groups=$(printf '%s\n' "$_rows" | group_rows)
	printf '%s\n' "$(ansi f9e2af 'Top apps')  ≈ footprint (sampled; shared pages over-count)"
	if [ -z "$_groups" ]; then
		printf '  (no footprint data)\n'
		return
	fi
	_max=$(printf '%s\n' "$_groups" | head -n1 | cut -f1)
	printf '%s\n' "$_groups" | head -n "$_limit" | while IFS="$(printf '\t')" read -r _mb _cnt _app; do
		printf '  %-22s %s ≈%-7s (%s)\n' \
			"$_app" "$(mem_bar "$_mb" "$_max" "$BAR_WIDTH")" \
			"$(mem_human_mb "$_mb")" "$_cnt"
	done
}

render_agents() {
	_agents=$1
	_limit=$2
	[ -n "$_agents" ] || return
	printf '%s\n' "$(ansi 89b4fa 'Agents')"
	printf '%s\n' "$_agents" | head -n "$_limit" | while IFS="$(printf '\t')" read -r _st _win _ppid; do
		printf '  %s %-22s %s\n' \
			"$(agent_glyph "$_st")" "$_win" "$(mem_human_mb "$(mem_heaviest_pid_mb "$_ppid")")"
	done
}

# render — the hibernate ranking is gathered in the background while the app
# sample runs, uncapped: "heaviest" needs every candidate measured and the `h`
# list must be complete, so the cost is hidden behind the snapshot rather
# than trimmed.
render() {
	_hib_file=$(mktemp)
	mem_hibernate_rows >"$_hib_file" &
	_hib_pid=$!
	CURRENT_ROWS=$(snapshot_rows "$TOP_PROCS")
	CURRENT_GROUPED=$(printf '%s\n' "$CURRENT_ROWS" | group_rows)
	wait "$_hib_pid"
	CURRENT_HIB_ROWS=$(cat "$_hib_file")
	rm -f "$_hib_file"
	render_header
	render_apps "$CURRENT_ROWS" "$TOP_APPS"
	printf '\n  [a] all sampled apps\n\n'
	render_agents "$(agent_rows)" "$TOP_AGENTS"
	printf '\n[k] manage process  [h] hibernate agents  [a] apps  [g] agents  [r] refresh  [q] close\n'
}

page() {
	if command -v less >/dev/null 2>&1; then
		less -R --mouse --wheel-lines=3
	else
		cat
	fi
}

show_apps() {
	snapshot_rows "$DETAIL_TOP_PROCS" | {
		_rows=$(cat)
		printf '%s\n\n' "Top apps - footprint-ranked sample of the $DETAIL_TOP_PROCS highest-RSS processes"
		render_apps "$_rows" 99999
		printf '\nUse / to search, q to close.\n'
	} | page
}

show_agents() {
	{
		printf '%s\n\n' 'Agents - all tracked panes, in tmux order'
		render_agents "$(agent_rows)" 99999
		printf '\nUse / to search, q to close.\n'
	} | page
}

pause_result() {
	printf '\nPress any key to return to memory triage...'
	_old=$(stty -g 2>/dev/null || true)
	stty raw -echo min 1 time 0 2>/dev/null || true
	dd bs=1 count=1 2>/dev/null >/dev/null
	[ -n "$_old" ] && stty "$_old" 2>/dev/null || true
}

choose_process() {
	[ -n "$CURRENT_GROUPED" ] || return 0
	_choice=$(printf '%s\n' "$CURRENT_GROUPED" | head -n "$TOP_APPS" |
		fzf --reverse --delimiter="$(printf '\t')" --with-nth=3,1,2 \
			--header='Choose a visible pressure contributor' 2>/dev/null) || return 0
	_app=$(printf '%s\n' "$_choice" | cut -f3)
	[ -n "$_app" ] || return 0
	_process=$(printf '%s\n' "$CURRENT_ROWS" |
		awk -F '\t' -v app="$_app" '$2 == app { printf "%s\t%s\t%s\t%s\n", $3, $1, $2, $4 }' |
		fzf --reverse --delimiter="$(printf '\t')" --with-nth=2,3,1,4 \
			--header="Choose a process from $_app" 2>/dev/null) || return 0
	_pid=$(printf '%s\n' "$_process" | cut -f1)
	case "$_pid" in *[!0-9]* | '') return 0 ;; esac
	zsh -ic "pclose --pid $_pid" || true
	pause_result
}

case "${1:-}" in
_one)
	emit_one "${2:-}"
	exit 0
	;;
_summary)
	render
	exit 0
	;;
_apps)
	show_apps
	exit 0
	;;
_agents)
	show_agents
	exit 0
	;;
_hibernate_rows)
	mem_hibernate_rows
	exit 0
	;;
_hibernate_apply)
	shift
	hibernate_apply "$@"
	exit 0
	;;
esac

while :; do
	clear 2>/dev/null || printf '\033[H\033[2J'
	render
	[ -t 0 ] || break
	_old=$(stty -g 2>/dev/null || true)
	stty raw -echo min 1 time 0 2>/dev/null || true
	_key=$(dd bs=1 count=1 2>/dev/null)
	[ -n "$_old" ] && stty "$_old" 2>/dev/null || true
	case "$_key" in
	r | R) continue ;;
	a | A) show_apps ;;
	g | G) show_agents ;;
	h | H) choose_agents_to_hibernate ;;
	k | K) choose_process ;;
	# Wheel events begin with Escape; do not let scrolling dismiss the summary.
	q | Q | "$(printf '\003')") break ;;
	*) continue ;;
	esac
done
