#!/bin/sh
# caffeine-lib.sh — shared keep-awake vocabulary for the tmux caffeinate
# subsystem. Sourced (never executed) so the popup driver and the status pill
# speak one language — ON | OFF, one colour/glyph/token set — defined once here.
# Mirrors mem-lib.sh / resurrect-lib.sh's one-lib-many-surfaces role.
#
# What it drives: `caffeinate -i` keeps the Mac awake (prevents idle *system*
# sleep) while, by omitting -d, letting the displays sleep on their normal
# schedule. State is a single managed process tracked by a pidfile so an active
# caffeinate is never silently left running in a forgotten shell.
#
# State is binary with an optional deadline, recorded in the pidfile as two
# fields "pid deadline_epoch" (deadline 0 = indefinite). caffeinate -i -t <secs>
# self-exits at the deadline, so ON-timed clears itself once the process dies.
# No `uname` branch is needed here: on Linux the pidfile never exists → OFF; only
# the popup's *start* action is macOS-gated (command -v caffeinate).
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# mem_state_colour / resurrect_state_colour.

# Pidfile holding "pid deadline_epoch". Env-overridable so bats can redirect it
# to an isolated HOME without spawning a real caffeinate.
CAFFEINE_PIDFILE=${CAFFEINE_PIDFILE:-$HOME/.cache/tmux-caffeinate.pid}

# ON accent colour — catppuccin peach, distinct from the mem/resurrect state
# colours (green/yellow/red) so the pill reads as a different signal entirely.
CAFFEINE_COLOUR=fab387

# ON glyph — ☼ (U+263C, white sun with rays): single-width text-presentation
# (unlike ☕ U+2615, which is emoji/double-width and would break pill alignment,
# same trap mem-lib notes for ⚠). "Sun / stay awake / no sleep" reads for the
# state, and it avoids every existing glyph vocabulary (mem ⬡⊟⊠, resurrect ⟳⚠,
# agent-dots ◆◐●○·). Env-overridable so a terminal that mis-renders it can swap.
CAFFEINE_GLYPH=${CAFFEINE_GLYPH:-☼}

# Indefinite-deadline token — ∞ (U+221E): ambiguous-width, single-cell in kitty
# like the ◆ agent-dot already is.
CAFFEINE_INFINITY=∞

# caffeine_pid — the managed pid from the pidfile's first field, empty if no
# pidfile.
caffeine_pid() {
	_pid=""
	if [ -f "$CAFFEINE_PIDFILE" ]; then
		_pid=$(awk 'NR == 1 { print $1 }' "$CAFFEINE_PIDFILE" 2>/dev/null)
	fi
	printf '%s' "$_pid"
}

# caffeine_deadline — the deadline epoch from the pidfile's second field; 0 for
# indefinite (or when absent/unset).
caffeine_deadline() {
	_dl=0
	if [ -f "$CAFFEINE_PIDFILE" ]; then
		_dl=$(awk 'NR == 1 { print ($2 == "" ? 0 : $2) }' "$CAFFEINE_PIDFILE" 2>/dev/null)
	fi
	printf '%s' "${_dl:-0}"
}

# caffeine_active — true when the recorded pid is a live process. A stale pidfile
# (pid dead — caffeinate hit its deadline or was killed) reads as inactive, so
# the state self-clears without a separate reaper.
caffeine_active() {
	_pid=$(caffeine_pid)
	[ -n "$_pid" ] || return 1
	kill -0 "$_pid" 2>/dev/null
}

# caffeine_state — ON when a managed caffeinate is live, else OFF.
caffeine_state() {
	if caffeine_active; then
		echo ON
	else
		echo OFF
	fi
}

# caffeine_remaining_secs — seconds until the deadline; -1 when indefinite
# (deadline 0). Never negative for a timed deadline (clamped to 0). Reads the
# deadline field directly, so it does not depend on liveness — callers gate on
# caffeine_state first (the token is only rendered while ON).
caffeine_remaining_secs() {
	_dl=$(caffeine_deadline)
	if [ "${_dl:-0}" -le 0 ] 2>/dev/null; then
		echo -1
		return
	fi
	_now=$(date +%s)
	_rem=$((_dl - _now))
	[ "$_rem" -lt 0 ] && _rem=0
	echo "$_rem"
}

# caffeine_human_age SECS — compact human age: Nd / Nh / Nm / Ns. The shared
# token formatter, identical to resurrect_human_age.
caffeine_human_age() {
	awk -v s="${1:-0}" 'BEGIN {
		if (s >= 86400) printf "%dd", s / 86400
		else if (s >= 3600) printf "%dh", s / 3600
		else if (s >= 60) printf "%dm", s / 60
		else printf "%ds", s
	}'
}

# caffeine_state_colour STATE — bare 6-hex accent colour for the pill. Only ON is
# rendered (OFF self-hides), so both map to peach; the signature stays parallel
# to mem_state_colour / resurrect_state_colour.
caffeine_state_colour() {
	case "$1" in
	*) printf '%s' "$CAFFEINE_COLOUR" ;;
	esac
}

# caffeine_state_glyph STATE — the pill glyph. Parallel signature to the other
# libs; ON is the only rendered state.
caffeine_state_glyph() {
	case "$1" in
	*) printf '%s' "$CAFFEINE_GLYPH" ;;
	esac
}

# caffeine_token — figure-slot content: ∞ while indefinite, else the human
# remaining time ("42m", "1h") that ticks down to the self-clearing deadline.
caffeine_token() {
	_rem=$(caffeine_remaining_secs)
	if [ "$_rem" -lt 0 ] 2>/dev/null; then
		printf '%s' "$CAFFEINE_INFINITY"
	else
		caffeine_human_age "$_rem"
	fi
}

# caffeine_start [SECS] — start a single managed caffeinate. SECS > 0 → timed
# (`caffeinate -i -t SECS`, self-exits at the deadline); 0/absent → indefinite
# (`caffeinate -i`). nohup so it survives the popup closing; $! is the pid we
# record. Any prior managed process is stopped first so only one is ever tracked.
caffeine_start() {
	_secs=${1:-0}
	_deadline=0
	caffeine_stop
	mkdir -p "$(dirname "$CAFFEINE_PIDFILE")"
	if [ "${_secs:-0}" -gt 0 ] 2>/dev/null; then
		_deadline=$(($(date +%s) + _secs))
		nohup caffeinate -i -t "$_secs" >/dev/null 2>&1 &
	else
		nohup caffeinate -i >/dev/null 2>&1 &
	fi
	_pid=$!
	printf '%s %s\n' "$_pid" "$_deadline" >"$CAFFEINE_PIDFILE"
}

# caffeine_stop — kill the managed process (if any) and drop the pidfile.
caffeine_stop() {
	_pid=$(caffeine_pid)
	if [ -n "$_pid" ]; then
		kill "$_pid" 2>/dev/null || true
	fi
	rm -f "$CAFFEINE_PIDFILE" 2>/dev/null || true
}

# caffeine_toggle [SECS] — off when on, else start (indefinite unless SECS given).
caffeine_toggle() {
	if caffeine_active; then
		caffeine_stop
	else
		caffeine_start "${1:-0}"
	fi
}
