#!/bin/sh
# mem-lib.sh — shared memory-pressure vocabulary for the three monitoring
# surfaces (status segment, prefix+M-m popup, memwatch notifier). Sourced
# (never executed) so all three speak one vocabulary — OK/BUSY/CRITICAL — with
# one colour/glyph language and one set of thresholds, defined once here so the
# surfaces never drift. Mirrors agent-state-lib.sh's role for the agent dots.
#
# Metric note: the jetsam killer (and Activity Monitor's "Memory" column) judge
# on phys_footprint, NOT RSS — RSS over-counts shared pages. The cheap signals
# (sysctl pressure level, compressor fill) drive the status segment every
# repaint; the expensive per-process footprint is only sampled by the popup and
# the watcher.
#
# State comes from three kernel readings: the pressure level and the fill of the
# compressor's two ceilings. Each ceiling is a hard limit the kernel panics at
# (`Compressor Info: 100% of compressed pages limit (BAD)`), and a process can
# stall userspace for minutes before that line is reached, so the fill is the
# early signal and the pressure level the instant one. Swap tracks the segments
# arm only (a swapout releases a segment but never a slot), so swap is a figure
# for the popup and the log, not an input to the state. Pressure 4 (critical)
# makes the state CRITICAL on its own and names the cause; pressure 2 (warn) is
# this machine's resting level under ordinary load, so it changes no state and
# only marks the figure: the pill shows ▲ before the fill (mem_token below).
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site.

# Thresholds — defined once, as a percentage of each ceiling. Slots
# (`vm.compressor.pages_compressed` over `.pages_compressed_limit`) fill with
# every page compressed and only empty when the owning process frees or exits,
# so they climb through a long session and are the arm the panic hit at 100%.
# Segments (`vm.compressor.segment.total` over `.segment.limit`) are relieved by
# swapout and compaction, so they sit lower and move faster. On this 16 GB
# machine ordinary days read 44-56% of slots and kill storms 60-65%; one 98% day
# survived and 100% did not, so BUSY sits at the storm line and CRITICAL well
# below the fatal one. Kernel pressure 4 (critical) escalates to CRITICAL
# independently and instantaneously; 2 (warn) is informational. Overridable for
# tests.
MEM_BUSY_SLOTS_PCT=${MEM_BUSY_SLOTS_PCT:-60}
MEM_CRITICAL_SLOTS_PCT=${MEM_CRITICAL_SLOTS_PCT:-80}
MEM_BUSY_SEGS_PCT=${MEM_BUSY_SEGS_PCT:-70}
MEM_CRITICAL_SEGS_PCT=${MEM_CRITICAL_SEGS_PCT:-85}

# Pressure marker, printed before the fill figure whenever the kernel pressure
# level is 2 (warn) or 4 (critical): ▲ (U+25B2) is single-width
# text-presentation in kitty (unlike ⚠ U+26A0, which renders emoji/double-width
# and would break pill alignment); the filled triangle contrasts the hollow
# state glyphs ⬡ ⊟ ⊠ and avoids ◆ (the blocked agent-dot, a cross-vocabulary
# collision).
MEM_CAUSE_GLYPH="▲"

# mem_pressure_level — kern.memorystatus_vm_pressure_level normalised to the
# documented set 1 (normal) / 2 (warn) / 4 (critical). Anything else (absent
# sysctl on Linux, unexpected value) collapses to 1 so non-macOS hosts read OK.
mem_pressure_level() {
	_lvl=$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null) || _lvl=""
	case "$_lvl" in
	2) echo 2 ;;
	4) echo 4 ;;
	*) echo 1 ;;
	esac
}

# mem_compressor_raw — the four compressor counters in one fork:
# "pages limit segments seglimit". `sysctl -n` with several keys prints one
# line per key it knows and nothing for one it does not, so a short answer
# (Linux, an older kernel) collapses to "0 0 0 0" rather than shifting fields.
# The split is done on the command substitution itself, never on a parameter
# holding it: memwatch sources this lib under zsh, which splits an unquoted
# `$(...)` on IFS but not an unquoted `$var`, and runs with `no_unset`, so the
# positionals are read with defaults.
mem_compressor_raw() {
	# shellcheck disable=SC2046  # deliberate split of one-value-per-line output
	set -- $(sysctl -n vm.compressor.pages_compressed vm.compressor.pages_compressed_limit \
		vm.compressor.segment.total vm.compressor.segment.limit 2>/dev/null)
	case "$#:${1:-}${2:-}${3:-}${4:-}" in
	4:*[!0-9]*) echo "0 0 0 0" ;;
	4:*) echo "$1 $2 $3 $4" ;;
	*) echo "0 0 0 0" ;;
	esac
}

# mem_pct_from VALUE LIMIT — integer percentage of LIMIT that VALUE fills,
# truncated. A zero or absent limit reads 0 so an unknown ceiling never alarms.
mem_pct_from() {
	awk -v v="${1:-0}" -v l="${2:-0}" 'BEGIN {
		if (l <= 0) print 0
		else printf "%d", v * 100 / l
	}'
}

# mem_ratio_from PAGES SEGMENTS — compressed pages per segment, one decimal.
# The two ceilings fill at this ratio to each other: above 8 (the limits'
# own ratio on this machine) slots reach 100% first. 0.0 when nothing is known.
mem_ratio_from() {
	awk -v p="${1:-0}" -v s="${2:-0}" 'BEGIN {
		if (s <= 0) print "0.0"
		else printf "%.1f", p / s
	}'
}

# mem_compressor_pcts — "SLOTS SEGS" fill percentages from one gather.
mem_compressor_pcts() {
	# shellcheck disable=SC2046  # deliberate split of "pages limit segs seglimit"
	set -- $(mem_compressor_raw)
	echo "$(mem_pct_from "$1" "$2") $(mem_pct_from "$3" "$4")"
}

# mem_swap_used_mb — integer MB of swap in use, parsed from vm.swapusage
# ("total = 4096.00M  used = 3109.69M  free = …"). Absent (Linux) → 0. A figure
# for the popup and the watcher's log; it is not an input to the state.
mem_swap_used_mb() {
	_su=$(sysctl -n vm.swapusage 2>/dev/null) || _su=""
	mem_swap_used_mb_from "$_su"
}

# mem_swap_used_mb_from VALUE — pure parser for a previously gathered
# vm.swapusage line. Absent or malformed input maps to zero.
mem_swap_used_mb_from() {
	_su=${1:-}
	if [ -z "$_su" ]; then
		echo 0
		return
	fi
	printf '%s\n' "$_su" | awk '{
		for (i = 1; i <= NF; i++) if ($i == "used") { v = $(i + 2); break }
		if (v == "") { print 0; exit }
		u = substr(v, length(v), 1)
		n = substr(v, 1, length(v) - 1) + 0
		if (u == "G") n = n * 1024
		else if (u == "K") n = n / 1024
		printf "%d", n
	}'
}

# mem_human_mb MB — integer MB → compact human size (≥1 G shown with one
# decimal, e.g. 2.6G; below that whole MB, e.g. 512M). The shared formatter.
mem_human_mb() {
	awk -v mb="${1:-0}" 'BEGIN {
		if (mb >= 1024) printf "%.1fG", mb / 1024
		else printf "%dM", mb
	}'
}

# mem_swap_human — swap-used as a compact human size.
mem_swap_human() {
	mem_human_mb "$(mem_swap_used_mb)"
}

# mem_state — map (pressure, slots%, segments%) → OK | BUSY | CRITICAL.
# Pressure 4 or either arm at its CRITICAL line is CRITICAL; either arm at its
# BUSY line is BUSY; else OK. Pressure 2 changes nothing here (see the header).
mem_state() {
	# shellcheck disable=SC2046  # deliberate split of "PRESSURE SLOTS SEGS"
	set -- $(mem_pressure_level) $(mem_compressor_pcts)
	mem_state_from "$1" "$2" "$3"
}

# mem_state_from PRESSURE SLOTS SEGS — pure state mapping for callers that
# gather the kernel values once and reuse them across state, cause and token.
mem_state_from() {
	_lvl=${1:-1}
	_slots=${2:-0}
	_segs=${3:-0}
	if [ "$_lvl" -ge 4 ] || [ "$_slots" -ge "$MEM_CRITICAL_SLOTS_PCT" ] ||
		[ "$_segs" -ge "$MEM_CRITICAL_SEGS_PCT" ]; then
		echo CRITICAL
	elif [ "$_slots" -ge "$MEM_BUSY_SLOTS_PCT" ] ||
		[ "$_segs" -ge "$MEM_BUSY_SEGS_PCT" ]; then
		echo BUSY
	else
		echo OK
	fi
}

# mem_state_colour STATE — bare 6-hex catppuccin colour for STATE. mem_segment
# renders these on its own surface1 (#45475a) pill, NOT the bar bg: green 6.1:1
# and yellow 7.2:1 clear WCAG AA; CRITICAL red is 3.9:1 (AA-large/UI only) but
# stays legible via triple-encoding (⊠ glyph + figure-or-cause-marker + bold).
# Unknown → green (fail quiet).
mem_state_colour() {
	case "$1" in
	OK) echo a6e3a1 ;;
	BUSY) echo f9e2af ;;
	CRITICAL) echo f38ba8 ;;
	*) echo a6e3a1 ;;
	esac
}

# mem_state_glyph STATE — distinct shape per STATE (triple-encoding: colour +
# glyph + presence-of-number, so the signal survives a colour clash and reads
# for colour-blind use). Hollow = quiet, boxed-minus = filling, boxed-x = bad.
mem_state_glyph() {
	case "$1" in
	OK) echo "⬡" ;;
	BUSY) echo "⊟" ;;
	CRITICAL) echo "⊠" ;;
	*) echo "⬡" ;;
	esac
}

# mem_binding_arm SLOTS SLINE SEGS GLINE — slots | segments: which compressor
# arm the figure slot reports. The arm at or over its line binds; when both or
# neither are over, the higher percentage binds, ties to slots (the arm that
# fills first at this machine's ratio and the one the panic hit).
mem_binding_arm() {
	_so=0
	_go=0
	[ "${1:-0}" -ge "${2:-0}" ] && _so=1
	[ "${3:-0}" -ge "${4:-0}" ] && _go=1
	if [ "$_so" -ne "$_go" ]; then
		if [ "$_so" -eq 1 ]; then echo slots; else echo segments; fi
	elif [ "${3:-0}" -gt "${1:-0}" ]; then
		echo segments
	else
		echo slots
	fi
}

# _mem_arm_for_state STATE SLOTS SEGS — the binding arm judged against the
# lines of STATE (CRITICAL's lines for CRITICAL, BUSY's for BUSY and OK, so a
# healthy reading still names the arm nearer its first line).
_mem_arm_for_state() {
	case "$1" in
	CRITICAL) mem_binding_arm "${2:-0}" "$MEM_CRITICAL_SLOTS_PCT" "${3:-0}" "$MEM_CRITICAL_SEGS_PCT" ;;
	*) mem_binding_arm "${2:-0}" "$MEM_BUSY_SLOTS_PCT" "${3:-0}" "$MEM_BUSY_SEGS_PCT" ;;
	esac
}

# mem_cause — none | pressure | slots | segments for the current reading: which
# signal drives the active state. `pressure` is only possible at CRITICAL
# (level 4); BUSY is always an arm, since warn pressure escalates nothing. OK is
# always cause=none.
mem_cause() {
	# shellcheck disable=SC2046  # deliberate split of "PRESSURE SLOTS SEGS"
	set -- $(mem_pressure_level) $(mem_compressor_pcts)
	mem_cause_from "$1" "$2" "$3"
}

# mem_cause_from PRESSURE SLOTS SEGS — pure cause mapping over gathered inputs.
mem_cause_from() {
	_lvl=${1:-1}
	_slots=${2:-0}
	_segs=${3:-0}
	_state=$(mem_state_from "$_lvl" "$_slots" "$_segs")
	case "$_state" in
	OK) echo none ;;
	CRITICAL) if [ "$_lvl" -ge 4 ]; then echo pressure; else _mem_arm_for_state CRITICAL "$_slots" "$_segs"; fi ;;
	BUSY) _mem_arm_for_state BUSY "$_slots" "$_segs" ;;
	esac
}

# mem_token — figure-slot content: the binding arm's fill as `NN%` — shown when
# OK too, so the resting baseline calibrates the eye — preceded by the ▲
# pressure marker whenever the kernel pressure level is 2 or 4 (`▲33%`).
mem_token() {
	# shellcheck disable=SC2046  # deliberate split of "PRESSURE SLOTS SEGS"
	set -- $(mem_pressure_level) $(mem_compressor_pcts)
	mem_token_from "$1" "$2" "$3"
}

# mem_token_from PRESSURE SLOTS SEGS — pure figure rendering over gathered inputs.
mem_token_from() {
	_lvl=${1:-1}
	_slots=${2:-0}
	_segs=${3:-0}
	[ "$_lvl" -ge 2 ] && printf '%s' "$MEM_CAUSE_GLYPH"
	_state=$(mem_state_from "$_lvl" "$_slots" "$_segs")
	case "$(_mem_arm_for_state "$_state" "$_slots" "$_segs")" in
	slots) printf '%s%%' "$_slots" ;;
	segments) printf '%s%%' "$_segs" ;;
	esac
}

# mem_arm_state PCT BUSY CRIT — OK | BUSY | CRITICAL for one arm alone, by the
# same at-or-over rule as mem_state_from, so the popup can colour each arm by
# its own standing rather than the overall state.
mem_arm_state() {
	if [ "${1:-0}" -ge "${3:-0}" ]; then
		echo CRITICAL
	elif [ "${1:-0}" -ge "${2:-0}" ]; then
		echo BUSY
	else
		echo OK
	fi
}

# mem_arm_gap PCT BUSY CRIT — the distance to the next line that changes the
# colour, in points of fill: `NN to amber` | `NN to red` | `NN over red`
# (exactly at the red line reads `0 over red`). Answers "how far from
# trouble" without the reader knowing the lines.
mem_arm_gap() {
	if [ "${1:-0}" -ge "${3:-0}" ]; then
		echo "$((${1:-0} - ${3:-0})) over red"
	elif [ "${1:-0}" -ge "${2:-0}" ]; then
		echo "$((${3:-0} - ${1:-0})) to red"
	else
		echo "$((${2:-0} - ${1:-0})) to amber"
	fi
}

# mem_attrs_from PRESSURE SLOTS SEGS — one status-render payload so callers do
# not fork once per derived attribute. Output: state<TAB>colour<TAB>glyph<TAB>token.
mem_attrs_from() {
	_state=$(mem_state_from "${1:-1}" "${2:-0}" "${3:-0}")
	printf '%s\t%s\t%s\t%s' "$_state" "$(mem_state_colour "$_state")" \
		"$(mem_state_glyph "$_state")" "$(mem_token_from "${1:-1}" "${2:-0}" "${3:-0}")"
}

# mem_parse_mb VALUE UNIT — normalise a footprint value+unit to integer MB.
# footprint(1) prints "phys_footprint: 509 MB" (or KB / GB / bytes). The popup
# and watcher feed the split fields here.
mem_parse_mb() {
	awk -v v="${1:-0}" -v u="${2:-MB}" 'BEGIN {
		n = v + 0
		if (u == "GB" || u == "G") n = n * 1024
		else if (u == "KB" || u == "K") n = n / 1024
		else if (u == "bytes" || u == "B") n = n / 1048576
		printf "%d", n
	}'
}

# mem_footprint_mb PID — phys_footprint of PID in integer MB (0 if the process
# is gone or footprint is unavailable). The jetsam-accurate per-process metric.
mem_footprint_mb() {
	_fp=$(footprint -p "${1:-0}" 2>/dev/null |
		awk '/phys_footprint:/ { print $2, $3; exit }')
	if [ -z "$_fp" ]; then
		echo 0
		return
	fi
	# shellcheck disable=SC2086  # deliberate split of "VALUE UNIT" into two args
	mem_parse_mb $_fp
}

# mem_app_name COMMAND — the group key for a process command line: the .app
# bundle name when present (truncated at the FIRST .app so nested helper
# bundles like "Google Chrome.app/.../Google Chrome Helper.app" roll up to the
# outer app), else the basename of the executable. Shared by the popup and the
# watcher so both group identically.
mem_app_name() {
	case "$1" in
	*.app/*)
		_p=$(echo "$1" | sed -E 's#(\.app)/.*#\1#')
		_b=$(basename -- "$_p")
		echo "${_b%.app}"
		;;
	*) basename -- "${1%% *}" ;;
	esac
}

# mem_group_apps — stdin rows "<mb>\t<app>"; stdout "<total_mb>\t<count>\t<app>"
# sorted by total descending. Aggregates per-app footprint and process count.
#
# CAVEAT: per-app footprint sums OVER-count shared pages (a Chrome sum can
# exceed physical RAM). The *ranking* is reliable; the absolute total is not —
# callers must render it as approximate (≈).
mem_group_apps() {
	awk -F '\t' '$2 != "" { mb[$2] += $1; cnt[$2]++ }
		END { for (a in mb) printf "%d\t%d\t%s\n", mb[a], cnt[a], a }' |
		sort -t "$(printf '\t')" -k1,1 -nr
}

# mem_bar VALUE MAX [WIDTH] — a WIDTH-wide ▓░ bar (default 12) giving non-colour
# magnitude, so the popup reads without relying on colour alone.
mem_bar() {
	awk -v v="${1:-0}" -v m="${2:-1}" -v w="${3:-12}" 'BEGIN {
		if (m <= 0) m = 1
		f = int(v / m * w + 0.5)
		if (f > w) f = w
		if (f < 0) f = 0
		s = ""
		for (i = 0; i < f; i++) s = s "▓"
		for (i = f; i < w; i++) s = s "░"
		printf "%s", s
	}'
}

# mem_bar_marked PCT WIDTH BUSY CRIT — mem_bar over 0-100 with a │ (U+2502)
# tick inserted *between* cells at the amber and red lines (cell index
# int(line × WIDTH / 100)), so the fill is lossless and the bar is WIDTH+2
# wide. At 20 wide the lines 60/80 and 70/85 land on whole cells, so a fill at
# the line touches its tick and the next cell past it shows past the tick.
mem_bar_marked() {
	awk -v v="${1:-0}" -v w="${2:-20}" -v a="${3:-0}" -v r="${4:-0}" 'BEGIN {
		f = int(v / 100 * w + 0.5)
		if (f > w) f = w
		if (f < 0) f = 0
		ai = int(a * w / 100)
		ri = int(r * w / 100)
		s = ""
		for (i = 0; i <= w; i++) {
			if (i == ai || i == ri) s = s "│"
			if (i < w) s = s (i < f ? "▓" : "░")
		}
		printf "%s", s
	}'
}

# mem_heaviest_pid_mb ROOT_PID — the largest phys_footprint (integer MB) in
# ROOT_PID's process tree, ROOT_PID included. A pane's agent is a descendant of
# the pane shell, so this ranks a pane by the process that actually holds the
# memory rather than by the shell.
mem_heaviest_pid_mb() {
	_pids=$(ps -axo pid=,ppid= | awk -v root="$1" '
		{ ppid[$1] = $2 }
		END {
			desc[root] = 1; changed = 1
			while (changed) {
				changed = 0
				for (p in ppid) if (!(p in desc) && (ppid[p] in desc)) { desc[p] = 1; changed = 1 }
			}
			for (p in desc) print p
		}')
	_best=0
	for _pid in $_pids; do
		_mb=$(mem_footprint_mb "$_pid")
		[ "$_mb" -gt "$_best" ] 2>/dev/null && _best=$_mb
	done
	printf '%s\n' "$_best"
}

# mem_hibernate_rows — the panes it is safe to hibernate, heaviest first:
# every idle or done Claude/Codex pane as "pane\tmb\tlabel\tstate\tloc". Shared
# by the popup's `h` list and memwatch's emergency tier so both rank identically.
mem_hibernate_rows() {
	tmux list-panes -a -F '#{@agent_state}	#{@agent_kind}	#{@agent_name}	#{window_name}	#{session_name}:#{window_index}.#{pane_index}	#{pane_pid}	#{pane_id}' 2>/dev/null |
		awk -F '\t' '$1 ~ /^(idle|done)$/ && $2 ~ /^(claude|codex)$/ {
			label = $3 == "" ? $4 : $3
			print $6 "\t" $7 "\t" label "\t" $1 "\t" $5
		}' |
		while IFS="$(printf '\t')" read -r _ppid _pane _label _state _loc; do
			[ -n "$_pane" ] || continue
			printf '%s\t%s\t%s\t%s\t%s\n' \
				"$_pane" "$(mem_heaviest_pid_mb "$_ppid")" "$_label" "$_state" "$_loc"
		done | sort -t "$(printf '\t')" -k2,2nr
}
