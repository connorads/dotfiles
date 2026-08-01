#!/bin/sh
# caffeine-lib.sh — shared keep-awake vocabulary for the tmux caffeinate
# subsystem. Sourced (never executed) so the popup driver, the status pill and
# the reconciler speak one language — ON | ON-LID | OFF, one colour/glyph/token
# set — defined once here. Mirrors mem-lib.sh / resurrect-lib.sh's
# one-lib-many-surfaces role.
#
# What it drives, in two modes:
#
#   idle — `caffeinate -i` keeps the Mac awake (prevents idle *system* sleep)
#          while, by omitting -d, letting the displays sleep on their normal
#          schedule. Cannot survive the lid closing.
#   lid  — additionally raises the `SleepDisabled` kernel flag via
#          `sudo -n pmset -a disablesleep 1`. Clamshell sleep is a separate
#          kernel path that never consults power assertions, so the whole
#          -i/-s/-d assertion family is structurally unable to stop it and the
#          flag is the only lever that survives the lid closing.
#
# State is a single managed process tracked by a pidfile so an active keep-awake
# is never silently left running in a forgotten shell. Lid mode has no process to
# hang the flag's lifetime on, so it records a *supervisor* whose trap clears the
# flag on every ordinary exit; caffeine-reconcile.sh is the backstop for SIGKILL,
# crash, panic and reboot, where no trap runs. See ../AGENTS.md "Caffeine".
#
# State is recorded in the pidfile as three fields "pid deadline_epoch mode"
# (deadline 0 = indefinite, mode idle|lid). Field 3 is optional and defaults to
# `idle`, so a pidfile written before lid mode existed keeps working unchanged.
# caffeinate -i -t <secs> self-exits at the deadline, so ON-timed clears itself
# once the process dies. No `uname` branch is needed here: on Linux the pidfile
# never exists → OFF; only the popup's *start* action is macOS-gated
# (command -v caffeinate).
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# mem_state_colour / resurrect_state_colour.

# Pidfile holding "pid deadline_epoch mode". Env-overridable so bats can redirect
# it to an isolated HOME without spawning a real caffeinate.
CAFFEINE_PIDFILE=${CAFFEINE_PIDFILE:-$HOME/.cache/tmux-caffeinate.pid}

# Where the lid supervisor's own stdout/stderr goes — the sudo/pmset/caffeinate
# chatter that would otherwise be swallowed, in the same never-`>/dev/null`
# posture as resurrect-keepalive.sh.
CAFFEINE_LOG=${CAFFEINE_LOG:-$HOME/.cache/tmux-caffeine.log}

# ON accent colour — catppuccin peach, distinct from the mem/resurrect state
# colours (green/yellow/red) so the pill reads as a different signal entirely.
CAFFEINE_COLOUR=fab387

# ON-LID accent colour — catppuccin maroon. Warm-family-adjacent to peach (the
# same keep-awake signal, escalated) without colliding with mem's red f38ba8.
CAFFEINE_LID_COLOUR=eba0ac

# ON glyph — ☼ (U+263C, white sun with rays): single-width text-presentation
# (unlike ☕ U+2615, which is emoji/double-width and would break pill alignment,
# same trap mem-lib notes for ⚠). "Sun / stay awake / no sleep" reads for the
# state, and it avoids every existing glyph vocabulary (mem ⬡⊟⊠, resurrect ⟳⚠,
# agent-dots ◆◐●○·). Env-overridable so a terminal that mis-renders it can swap.
CAFFEINE_GLYPH=${CAFFEINE_GLYPH:-☼}

# ON-LID glyph — ✷ (U+2737, eight pointed rectilinear black star): east-asian
# width N, the same single-width class as ☼, so the pill keeps its alignment.
# Distinct from every existing vocabulary (mem ⬡⊟⊠, resurrect ⟳⚠, agent ◆◐●○·,
# vox ~≈✓). Env-overridable, mirroring CAFFEINE_GLYPH.
CAFFEINE_LID_GLYPH=${CAFFEINE_LID_GLYPH:-✷}

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

# caffeine_mode — the mode from the pidfile's third field: `idle` | `lid`.
# Anything that is not exactly `lid` — including an absent field, i.e. every
# pidfile written before lid mode existed — reads as `idle`, so no migration is
# needed and an unreadable field can never claim the privileged mode.
caffeine_mode() {
	_mode=idle
	if [ -f "$CAFFEINE_PIDFILE" ]; then
		_mode=$(awk 'NR == 1 { print ($3 == "lid" ? "lid" : "idle") }' "$CAFFEINE_PIDFILE" 2>/dev/null)
	fi
	printf '%s' "${_mode:-idle}"
}

# caffeine_active — true when the recorded pid is a live process. A stale pidfile
# (pid dead — caffeinate hit its deadline or was killed) reads as inactive, so
# the state self-clears without a separate reaper.
caffeine_active() {
	_pid=$(caffeine_pid)
	[ -n "$_pid" ] || return 1
	kill -0 "$_pid" 2>/dev/null
}

# caffeine_state — ON-LID when a lid session's supervisor is live, ON for an
# ordinary keep-awake, else OFF. Derived from the pidfile alone: this renders on
# every status tick, so it must never fork `pmset` (see caffeine_sleep_disabled).
caffeine_state() {
	if caffeine_active; then
		if [ "$(caffeine_mode)" = "lid" ]; then
			echo ON-LID
		else
			echo ON
		fi
	else
		echo OFF
	fi
}

# caffeine_sleep_disabled — true when the real `SleepDisabled` kernel flag is
# raised. An unprivileged read of the ground truth, used by the popup's recovery
# row and by the reconciler; deliberately NOT used by caffeine_state, which the
# status pill calls every tick and which must not fork pmset. `pmset -g` omits
# the key entirely when the flag is clear, so absent reads as off.
caffeine_sleep_disabled() {
	command -v pmset >/dev/null 2>&1 || return 1
	pmset -g 2>/dev/null |
		awk '$1 == "SleepDisabled" { on = ($2 + 0 != 0) } END { exit !on }'
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

# caffeine_clock_at EPOCH — local wall-clock HH:MM for an epoch second, for
# surfaces that answer "until when" rather than "how much longer". BSD date takes
# -r, GNU date takes -d @, and neither accepts the other's flag (GNU's -r means
# "reference file", so it fails on a bare number and falls through), so both are
# tried. Prints nothing where neither works; every caller renders it optionally.
caffeine_clock_at() {
	date -r "$1" +%H:%M 2>/dev/null || date -d "@$1" +%H:%M 2>/dev/null || printf ''
}

# caffeine_extend_total ADD — the duration a running session becomes when ADD
# seconds are added to what is left of it. Prints seconds-from-now, which is what
# the drive layer takes, so extending is `caffeine_start*` with a bigger number:
# `caffeinate -t` fixes its deadline at exec and offers no way to move it, so an
# extension is always a stop-and-restart, never an in-place edit.
#
# Adding to the *remainder* rather than setting a fresh total is what makes this
# an extension: setting would silently shorten a session with more left on it
# than the amount picked.
#
# Returns: 0 printed · 1 nothing is running · 2 ADD is not a positive integer ·
# 3 the session is indefinite, so there is no bounded thing to add to.
caffeine_extend_total() {
	_add=${1:-0}
	[ "${_add:-0}" -gt 0 ] 2>/dev/null || return 2
	caffeine_active || return 1
	_rem=$(caffeine_remaining_secs)
	[ "$_rem" -ge 0 ] 2>/dev/null || return 3
	echo $((_rem + _add))
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

# caffeine_state_colour STATE — bare 6-hex accent colour for the pill. ON-LID is
# maroon (the escalated signal: the Mac cannot sleep at all, lid included),
# everything else peach. OFF self-hides, so its colour is never rendered; the
# signature stays parallel to mem_state_colour / resurrect_state_colour.
caffeine_state_colour() {
	case "$1" in
	ON-LID) printf '%s' "$CAFFEINE_LID_COLOUR" ;;
	*) printf '%s' "$CAFFEINE_COLOUR" ;;
	esac
}

# caffeine_state_glyph STATE — the pill glyph: ✷ for ON-LID, ☼ otherwise.
# Parallel signature to the other libs.
caffeine_state_glyph() {
	case "$1" in
	ON-LID) printf '%s' "$CAFFEINE_LID_GLYPH" ;;
	*) printf '%s' "$CAFFEINE_GLYPH" ;;
	esac
}

# caffeine_token — figure-slot content: ∞ while indefinite, else the human
# remaining time ("42m", "1h") that ticks down to the self-clearing deadline.
# Lid mode is always timed, so it never renders ∞.
caffeine_token() {
	_rem=$(caffeine_remaining_secs)
	if [ "$_rem" -lt 0 ] 2>/dev/null; then
		printf '%s' "$CAFFEINE_INFINITY"
	else
		caffeine_human_age "$_rem"
	fi
}

# _caffeine_wait_dead PID — bounded (~2s) wait for PID to disappear, so a stop
# has genuinely completed before the caller starts anything new. Returns 0 once
# the pid is gone (or has been reaped to a zombie), 1 on timeout.
#
# The zombie check is load-bearing, not defensive: the popup starts and stops a
# lid session from the *same* shell, so the supervisor is that shell's own child
# and `kill -0` keeps succeeding on the un-reaped zombie long after its trap has
# run. Without it every stop would stall for the full 2s.
_caffeine_wait_dead() {
	_wd_pid=$1
	_wd_i=0
	while [ "$_wd_i" -lt 20 ]; do
		kill -0 "$_wd_pid" 2>/dev/null || return 0
		case "$(ps -o state= -p "$_wd_pid" 2>/dev/null)" in
		Z*) return 0 ;;
		esac
		sleep 0.1
		_wd_i=$((_wd_i + 1))
	done
	return 1
}

# caffeine_start [SECS] — start a single managed caffeinate in `idle` mode.
# SECS > 0 → timed (`caffeinate -i -t SECS`, self-exits at the deadline);
# 0/absent → indefinite (`caffeinate -i`). nohup so it survives the popup
# closing; $! is the pid we record. Any prior managed process is stopped first so
# only one is ever tracked.
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
	printf '%s %s %s\n' "$_pid" "$_deadline" idle >"$CAFFEINE_PIDFILE"
}

# caffeine_start_lid SECS — start a lid-mode keep-awake: a supervisor process
# that raises the SleepDisabled kernel flag and clears it again from a trap on
# every ordinary exit (manual stop, deadline expiry, SIGTERM).
#
# Three constraints remove failure states by construction rather than by
# discipline:
#
#   - Always timed. SECS must be > 0; there is no indefinite variant, because an
#     indefinite lid session — a Mac that never sleeps, in a bag or on a flight,
#     until the battery dies — is the exact artefact this subsystem exists to
#     prevent.
#   - The trap is installed BEFORE the flag is ever raised, so there is no window
#     in which the flag is set with nothing to clear it.
#   - The flag is read back before the pidfile is written. A minority of macOS 26
#     reports say `disablesleep` does not stick, and a pill that lies about
#     keeping the Mac awake reproduces the original bug with extra steps, so a
#     failed set never produces an ON-LID pill.
#
# The supervisor keeps `caffeinate -i` inside it for defence in depth and so idle
# sleep is held identically in both modes, and `wait`s on it rather than exec-ing
# it — an exec would replace the shell and take the trap with it. It kills that
# child from the trap too, so a stop leaves no stray caffeinate behind.
#
# Returns: 0 started and verified · 2 SECS not a positive integer · 3 no pmset ·
# 4 the flag did not take (nothing left running, nothing claiming ON-LID).
caffeine_start_lid() {
	_secs=${1:-0}
	[ "${_secs:-0}" -gt 0 ] 2>/dev/null || return 2
	command -v pmset >/dev/null 2>&1 || return 3
	caffeine_stop
	mkdir -p "$(dirname "$CAFFEINE_PIDFILE")" "$(dirname "$CAFFEINE_LOG")"

	# The trap body is a function name rather than an inline command list, so the
	# whole supervisor stays single-quoted and $cpid resolves when the trap
	# *fires* rather than when it is set. The TERM/INT traps exit explicitly:
	# without that, POSIX sh runs the handler and then carries on waiting, so a
	# `kill` would clear the flag but leave the supervisor alive.
	#
	# shellcheck disable=SC2016  # not expanding here is the point: $cpid and $1
	# belong to the supervisor's own shell, at trap-fire time, not to this one.
	nohup sh -c 'cpid=
		_caffeine_lid_cleanup() {
			[ -n "$cpid" ] && kill "$cpid" 2>/dev/null
			sudo -n /usr/bin/pmset -a disablesleep 0
		}
		trap _caffeine_lid_cleanup EXIT
		trap "exit 143" TERM
		trap "exit 130" INT
		sudo -n /usr/bin/pmset -a disablesleep 1 || exit 1
		caffeinate -i -t "$1" &
		cpid=$!
		wait "$cpid"' _ "$_secs" >>"$CAFFEINE_LOG" 2>&1 &
	_pid=$!

	# Read the kernel flag back before anything claims ON-LID. Bounded to ~3s,
	# and cut short the moment the supervisor dies (a refused sudo exits at once).
	_i=0
	while [ "$_i" -lt 30 ]; do
		caffeine_sleep_disabled && break
		kill -0 "$_pid" 2>/dev/null || break
		sleep 0.1
		_i=$((_i + 1))
	done
	if ! caffeine_sleep_disabled; then
		kill "$_pid" 2>/dev/null || true
		_caffeine_wait_dead "$_pid" || true
		return 4
	fi

	printf '%s %s %s\n' "$_pid" "$(($(date +%s) + _secs))" lid >"$CAFFEINE_PIDFILE"
}

# caffeine_stop — kill the managed process (if any), wait for it to actually die,
# then drop the pidfile.
#
# The wait is load-bearing rather than tidiness. caffeine_start* calls
# caffeine_stop first; without it an outgoing lid supervisor's trap can fire
# *after* the incoming one has raised the flag, silently disarming a session the
# pill reports as ON-LID. Bounded, so a wedged supervisor cannot hang the popup —
# the reconciler is the backstop for that.
caffeine_stop() {
	_pid=$(caffeine_pid)
	if [ -n "$_pid" ]; then
		kill "$_pid" 2>/dev/null || true
		_caffeine_wait_dead "$_pid" || true
	fi
	rm -f "$CAFFEINE_PIDFILE" 2>/dev/null || true
}

# caffeine_clear_sleep_disabled — clear the kernel flag directly, without going
# through a supervisor. The recovery path for a flag left raised by a SIGKILL,
# crash, panic or reboot, where no trap ran: used by the popup's recovery row and
# by caffeine-reconcile.sh. Never part of an ordinary stop, which the trap owns.
caffeine_clear_sleep_disabled() {
	sudo -n /usr/bin/pmset -a disablesleep 0
}

# caffeine_toggle [SECS] — off when on, else start (indefinite unless SECS given).
# Idle mode only: lid mode is never a blind toggle, it is always an explicit
# timed choice.
caffeine_toggle() {
	if caffeine_active; then
		caffeine_stop
	else
		caffeine_start "${1:-0}"
	fi
}
