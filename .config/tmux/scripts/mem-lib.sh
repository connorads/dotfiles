#!/bin/sh
# mem-lib.sh — shared memory-pressure vocabulary for the three monitoring
# surfaces (status segment, prefix+M-m popup, memwatch notifier). Sourced
# (never executed) so all three speak one vocabulary — OK/BUSY/CRITICAL — with
# one colour/glyph language and one set of thresholds, defined once here so the
# surfaces never drift. Mirrors agent-state-lib.sh's role for the agent dots.
#
# Metric note: the jetsam killer (and Activity Monitor's "Memory" column) judge
# on phys_footprint, NOT RSS — RSS over-counts shared pages. The cheap signals
# (sysctl pressure level, swap-used) drive the status segment every repaint; the
# expensive per-process footprint is only sampled by the popup/watcher.
#
# Pressure often reads 1 (normal) while the machine is actively swapping, so
# swap-used is the primary visible signal and pressure is the colour accent.
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# ai_usage's _usage_colour convention in status-right.sh.

# Thresholds — defined once. Swap escalates state even when pressure reads
# normal (1): >=1 G of swap means the working set already exceeds RAM (BUSY),
# >=4 G means chronic exhaustion (CRITICAL). Overridable for tests.
MEM_BUSY_SWAP_MB=${MEM_BUSY_SWAP_MB:-1024}
MEM_CRITICAL_SWAP_MB=${MEM_CRITICAL_SWAP_MB:-4096}

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

# mem_swap_used_mb — integer MB of swap in use, parsed from vm.swapusage
# ("total = 4096.00M  used = 3109.69M  free = …"). Absent (Linux) → 0.
mem_swap_used_mb() {
	_su=$(sysctl -n vm.swapusage 2>/dev/null) || _su=""
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

# mem_state — map (pressure, swap) → OK | BUSY | CRITICAL. Pressure 4 or large
# swap is CRITICAL; pressure 2 (warn) or moderate swap is BUSY; else OK.
mem_state() {
	_lvl=$(mem_pressure_level)
	_swap=$(mem_swap_used_mb)
	if [ "$_lvl" -ge 4 ] || [ "$_swap" -ge "$MEM_CRITICAL_SWAP_MB" ]; then
		echo CRITICAL
	elif [ "$_lvl" -ge 2 ] || [ "$_swap" -ge "$MEM_BUSY_SWAP_MB" ]; then
		echo BUSY
	else
		echo OK
	fi
}

# mem_state_colour STATE — bare 6-hex catppuccin colour for STATE. All pass
# WCAG AA (≥7:1) on the status bar background. Unknown → green (fail quiet).
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
# for colour-blind use). Hollow = quiet, boxed-minus = swapping, boxed-x = bad.
mem_state_glyph() {
	case "$1" in
	OK) echo "⬡" ;;
	BUSY) echo "⊟" ;;
	CRITICAL) echo "⊠" ;;
	*) echo "⬡" ;;
	esac
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

# mem_group_apps — stdin rows "<mb>\t<app>"; stdout "<total_mb>\t<count>\t<app>"
# sorted by total descending. Aggregates per-app footprint and process count.
#
# CAVEAT: per-app footprint sums OVER-count shared pages (a Chrome sum can
# exceed physical RAM). The *ranking* is reliable; the absolute total is not —
# callers must render it as approximate (≈).
mem_group_apps() {
	awk -F '\t' '{ mb[$2] += $1; cnt[$2]++ }
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
