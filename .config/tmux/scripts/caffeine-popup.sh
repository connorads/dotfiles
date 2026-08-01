#!/bin/sh
# caffeine-popup.sh — prefix + Alt+k keep-awake toggle. A small key-loop popup
# (raw-tty single-byte read, clear/redraw) in the shape of mem-popup.sh, driving
# the caffeine-lib state. One key, three states:
#
#   OFF     [i] indefinitely, [t] for a set time, [l] with the lid closed
#   ON      [+] add time (timed only), [space]/[o] turn off
#   ON-LID  [+] add time, [space]/[o] turn off
#
# Plus a recovery row, rendered in any state whenever the real SleepDisabled
# kernel flag is raised without a live lid session behind it — the SIGKILL /
# crash / panic / reboot case, where no supervisor trap ran. caffeine-reconcile.sh
# clears that within 5 minutes anyway; the row lets a human at the keyboard fix
# it now, and makes an otherwise invisible stuck state legible.
#
# After any toggle it refreshes the client so the status pill updates at once.
#
# Only the *start* action is macOS-gated: caffeinate is a Darwin binary, so on
# Linux the popup explains it is unsupported and waits for a key.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=/dev/null
. "$SELF_DIR/caffeine-lib.sh"

HAS_CAFFEINATE=0
command -v caffeinate >/dev/null 2>&1 && HAS_CAFFEINATE=1

# ansi HEX TEXT — truecolour-wrap TEXT, matching mem-popup's helper.
ansi() {
	_hex=$1
	_r=$((0x$(echo "$_hex" | cut -c1-2)))
	_g=$((0x$(echo "$_hex" | cut -c3-4)))
	_b=$((0x$(echo "$_hex" | cut -c5-6)))
	printf '\033[38;2;%d;%d;%dm%s\033[0m' "$_r" "$_g" "$_b" "$2"
}

clear_screen() {
	clear 2>/dev/null || printf '\033[H\033[2J'
}

# read_key — one raw byte from the tty (returns it, empty on EOF). Space and
# other printable keys survive command substitution (only trailing newlines are
# stripped).
read_key() {
	_old=$(stty -g 2>/dev/null || true)
	stty raw -echo min 1 time 0 2>/dev/null || true
	_k=$(dd bs=1 count=1 2>/dev/null)
	[ -n "$_old" ] && stty "$_old" 2>/dev/null || true
	printf '%s' "$_k"
}

# refresh — repaint status bars now so the caffeine pill appears/hides at once.
refresh() {
	tmux refresh-client -S 2>/dev/null || true
}

# on_battery — true when the Mac is running off the battery. Only ever consulted
# for the lid row, which is the one choice whose cost depends on it.
on_battery() {
	pmset -g batt 2>/dev/null | head -1 | grep -q "'Battery Power'"
}

# power_label — what the lid row says about where the power is coming from.
power_label() {
	if on_battery; then
		printf 'on battery'
	else
		printf 'on mains'
	fi
}

# recovery_row — the stuck-flag warning, shown whenever the kernel says the Mac
# cannot sleep but no live lid session is holding it that way. Printed by every
# render, so it is impossible to have the flag set and not be told.
recovery_row() {
	[ "$1" = "ON-LID" ] && return 0
	caffeine_sleep_disabled || return 0
	printf '\n  %s\n' "$(ansi eba0ac '⚠ This Mac still cannot sleep at all.')"
	printf '  A lid session left the kernel flag set without clearing it.\n'
	printf '  [c]   clear it now   (otherwise cleared within 5 min)\n'
}

render() {
	_state=$(caffeine_state)
	_glyph=$(caffeine_state_glyph "$_state")
	_colour=$(caffeine_state_colour "$_state")
	case "$_state" in
	ON-LID)
		_rem=$(caffeine_remaining_secs)
		printf '%s %s  Keep awake\n\n' "$(ansi "$_colour" "$_glyph")" "$(ansi "$_colour" ON-LID)"
		printf '  The lid can be closed — the Mac cannot sleep at all.\n'
		printf '  %s remaining, until %s — then it self-clears and\n' \
			"$(caffeine_human_age "$_rem")" "$(caffeine_clock_at "$(($(date +%s) + _rem))")"
		printf '  normal sleep returns.\n\n'
		printf '  [+]             add time\n'
		printf '  [space] / [o]   turn off\n'
		printf '  [q]             close\n'
		;;
	ON)
		_rem=$(caffeine_remaining_secs)
		if [ "$_rem" -lt 0 ] 2>/dev/null; then
			_detail="on indefinitely — until you turn it off"
		else
			_detail="$(caffeine_human_age "$_rem") remaining, until $(caffeine_clock_at "$(($(date +%s) + _rem))") — then it self-clears"
		fi
		printf '%s %s   Keep awake\n\n' "$(ansi "$_colour" "$_glyph")" "$(ansi "$_colour" ON)"
		printf '  System sleep is held; the displays still sleep normally.\n'
		printf '  Closing the lid still sleeps the Mac — use [l] from OFF for that.\n'
		printf '  %s\n\n' "$_detail"
		# No add-time row while indefinite: there is no bounded thing to add to,
		# and offering the key would make it look as though there were.
		[ "$_rem" -ge 0 ] 2>/dev/null && printf '  [+]             add time\n'
		printf '  [space] / [o]   turn off\n'
		printf '  [q]             close\n'
		;;
	*)
		printf '%s %s  Keep awake\n\n' "$(ansi 6c7086 "$_glyph")" "$(ansi 6c7086 OFF)"
		printf '  The Mac sleeps on its normal schedule.\n'
		printf '  Keeping awake holds system sleep but lets the displays sleep.\n\n'
		printf '  [i]   keep awake indefinitely\n'
		printf '  [t]   keep awake for a set time\n'
		printf '  %s   keep awake with the lid closed   (timed only · %s)\n' \
			"$(ansi "$CAFFEINE_LID_COLOUR" '[l]')" "$(power_label)"
		printf '  [q]   close\n'
		;;
	esac
	recovery_row "$_state"
}

# choose_timed [lid] — fzf-pick a duration, then start a keep-awake. With no
# argument that is an ordinary `idle` session; with `lid` it is a lid session,
# which has no indefinite path to offer and so always arrives here.
choose_timed() {
	_mode=${1:-idle}
	_header='Keep awake for…'
	[ "$_mode" = "lid" ] && _header='Keep awake with the lid closed for…'
	_choice=$(printf '30 minutes\t1800\n1 hour\t3600\n2 hours\t7200\n4 hours\t14400\n8 hours\t28800\n' |
		fzf --reverse --delimiter="$(printf '\t')" --with-nth=1 \
			--header="$_header" 2>/dev/null) || return 0
	_secs=$(printf '%s' "$_choice" | cut -f2)
	case "$_secs" in
	'' | *[!0-9]*) return 0 ;;
	esac
	if [ "$_mode" = "lid" ]; then
		start_lid "$_secs"
	else
		caffeine_start "$_secs"
	fi
	refresh
}

# choose_extend — add time to a running session, keeping its mode. The rows name
# the resulting end time, not the amount alone: the question being answered here
# is "will it outlast the run", which a bare "+1 hour" does not answer.
#
# It restarts the session rather than editing it — `caffeinate -t` fixes its
# deadline at exec. For lid mode that briefly drops the kernel flag between the
# outgoing trap and the new supervisor, which is safe by construction: reaching
# this key means a hand on the keyboard and an open lid, so the clamshell path
# the flag guards cannot fire in the gap.
choose_extend() {
	_rem=$(caffeine_remaining_secs)
	[ "$_rem" -ge 0 ] 2>/dev/null || return 0
	_mode=$(caffeine_mode)
	_now=$(date +%s)
	_rows=$(
		for _opt in '30 minutes:1800' '1 hour:3600' '2 hours:7200' '4 hours:14400' '8 hours:28800'; do
			_add=${_opt#*:}
			printf '+%s  (until %s)\t%s\n' "${_opt%:*}" \
				"$(caffeine_clock_at $((_now + _rem + _add)))" "$_add"
		done
	)
	_choice=$(printf '%s\n' "$_rows" |
		fzf --reverse --delimiter="$(printf '\t')" --with-nth=1 \
			--header="Add to $(caffeine_human_age "$_rem") remaining…" 2>/dev/null) || return 0
	_add=$(printf '%s' "$_choice" | cut -f2)
	case "$_add" in
	'' | *[!0-9]*) return 0 ;;
	esac
	# Re-read the remainder here rather than reusing the one the labels were built
	# from, so the time spent choosing is not silently added on top.
	_total=$(caffeine_extend_total "$_add") || return 0
	if [ "$_mode" = "lid" ]; then
		start_lid "$_total" extend
	else
		caffeine_start "$_total"
	fi
	refresh
}

# confirm_battery — name the risk in the user's own terms before a lid session on
# battery. Not a generic "are you sure": the two costs that actually apply are a
# battery drained flat and a machine running hot in a closed shell with no
# airflow, and the better answer is usually not to run it here at all.
confirm_battery() {
	clear_screen
	printf '%s\n\n' "$(ansi "$CAFFEINE_LID_COLOUR" '✷  Keep awake with the lid closed — on battery')"
	printf '  Nothing will sleep this Mac while the session runs, lid or not.\n'
	printf '  On battery that drains it flat, and a closed shell has no airflow,\n'
	printf '  so it runs hot the whole time.\n\n'
	printf '  Plug in first — or send the work to a machine that is meant to be\n'
	printf '  on: atp --host dev moves a live agent session there.\n\n'
	printf '  [y]   start anyway\n'
	printf '  [q]   back\n'
	case "$(read_key)" in
	y | Y) return 0 ;;
	*) return 1 ;;
	esac
}

# start_lid SECS [CTX] — confirm if needed, start, and report a refused or
# ineffective set rather than silently showing nothing. caffeine_start_lid
# verifies the kernel flag before it claims anything, so a non-zero return here
# means the Mac is *not* being kept awake — which the user has to be told, or the
# lie is worse than the failure.
#
# CTX is `extend` when this is replacing a session that was already running, so
# the failure text can say that session is gone too. The battery confirm runs
# before anything is stopped, so declining one leaves the running session intact.
start_lid() {
	_ctx=${2:-start}
	if on_battery && ! confirm_battery; then
		return 0
	fi
	caffeine_start_lid "$1"
	_rc=$?
	[ "$_rc" -eq 0 ] && return 0
	clear_screen
	printf '%s\n\n' "$(ansi f38ba8 'Could not keep awake with the lid closed')"
	case "$_rc" in
	3) printf '  This host has no pmset, so the kernel sleep flag does not exist.\n' ;;
	4)
		printf '  The SleepDisabled kernel flag did not take, so the lid would\n'
		printf '  still sleep the Mac. Nothing was started and nothing claims\n'
		printf '  otherwise.\n\n'
		printf '  Check sudo -n /usr/bin/pmset -a disablesleep 1 works, and see\n'
		printf '  %s for details.\n' "$CAFFEINE_LOG"
		;;
	*) printf '  Refused: a lid session must be given a duration.\n' ;;
	esac
	# An extension has already stopped what it was extending, so the rc-4 line's
	# "nothing was started" would otherwise read as "nothing changed".
	[ "$_ctx" = "extend" ] &&
		printf '\n  The session you were extending has stopped, so the Mac is no\n  longer being kept awake.\n'
	printf '\n  Press any key to close.\n'
	read_key >/dev/null
	return 0
}

# Unsupported host (no caffeinate): explain and wait for a key.
if [ "$HAS_CAFFEINATE" -ne 1 ]; then
	clear_screen
	printf '%s\n\n' "$(ansi f9e2af 'Keep awake')"
	printf '  Keep awake needs macOS (the caffeinate binary).\n'
	printf '  This host has no caffeinate, so there is nothing to toggle.\n\n'
	printf '  Press any key to close.\n'
	[ -t 0 ] && read_key >/dev/null
	exit 0
fi

_etx=$(printf '\003')
while :; do
	clear_screen
	render
	[ -t 0 ] || break
	_key=$(read_key)
	# The recovery key is checked before the per-state dispatch: a stuck flag can
	# coexist with any state, so `c` must work from all of them.
	if [ "$_key" = "c" ] || [ "$_key" = "C" ]; then
		if [ "$(caffeine_state)" != "ON-LID" ] && caffeine_sleep_disabled; then
			caffeine_clear_sleep_disabled
			refresh
			continue
		fi
	fi
	case "$(caffeine_state)" in
	ON | ON-LID)
		case "$_key" in
		# `=` is `+` unshifted, accepted for the same reason vim and tmux's own
		# resize bindings take both.
		'+' | '=') choose_extend ;;
		' ' | o | O)
			caffeine_stop
			refresh
			;;
		q | Q | "$_etx") break ;;
		*) : ;;
		esac
		;;
	OFF)
		case "$_key" in
		i | I)
			caffeine_start 0
			refresh
			;;
		t | T) choose_timed ;;
		l | L) choose_timed lid ;;
		q | Q | "$_etx") break ;;
		*) : ;;
		esac
		;;
	esac
done
