#!/bin/sh
# caffeine-popup.sh — prefix + Alt+k keep-awake toggle. A small key-loop popup
# (raw-tty single-byte read, clear/redraw) in the shape of mem-popup.sh, driving
# the caffeine-lib state. OFF: [i] keep awake indefinitely, [t] for a set time,
# [q] close. ON: [space]/[o] turn off, [q] close. After any toggle it refreshes
# the client so the status pill updates at once.
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

render() {
	_state=$(caffeine_state)
	_glyph=$(caffeine_state_glyph "$_state")
	if [ "$_state" = "ON" ]; then
		_colour=$(caffeine_state_colour "$_state")
		_rem=$(caffeine_remaining_secs)
		if [ "$_rem" -lt 0 ] 2>/dev/null; then
			_detail="on indefinitely — until you turn it off"
		else
			_detail="$(caffeine_human_age "$_rem") remaining, then self-clears"
		fi
		printf '%s %s   Keep awake\n\n' "$(ansi "$_colour" "$_glyph")" "$(ansi "$_colour" ON)"
		printf '  System sleep is held; the displays still sleep normally.\n'
		printf '  %s\n\n' "$_detail"
		printf '  [space] / [o]   turn off\n'
		printf '  [q]             close\n'
	else
		printf '%s %s  Keep awake\n\n' "$(ansi 6c7086 "$_glyph")" "$(ansi 6c7086 OFF)"
		printf '  The Mac sleeps on its normal schedule.\n'
		printf '  Keeping awake holds system sleep but lets the displays sleep.\n\n'
		printf '  [i]   keep awake indefinitely\n'
		printf '  [t]   keep awake for a set time\n'
		printf '  [q]   close\n'
	fi
}

# choose_timed — fzf-pick a duration, then start a timed keep-awake.
choose_timed() {
	_choice=$(printf '30 minutes\t1800\n1 hour\t3600\n2 hours\t7200\n4 hours\t14400\n8 hours\t28800\n' |
		fzf --reverse --delimiter="$(printf '\t')" --with-nth=1 \
			--header='Keep awake for…' 2>/dev/null) || return 0
	_secs=$(printf '%s' "$_choice" | cut -f2)
	case "$_secs" in
	'' | *[!0-9]*) return 0 ;;
	esac
	caffeine_start "$_secs"
	refresh
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
	case "$(caffeine_state)" in
	ON)
		case "$_key" in
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
		q | Q | "$_etx") break ;;
		*) : ;;
		esac
		;;
	esac
done
