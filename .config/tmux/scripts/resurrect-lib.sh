#!/bin/sh
# resurrect-lib.sh — shared tmux-resurrect freshness vocabulary. Sourced (never
# executed) so every surface speaks one language — FRESH | AGING | STALE | NONE,
# one colour/glyph set, one set of thresholds defined once here. Mirrors
# mem-lib.sh's role for the memory gauge.
#
# Why this exists: continuum's autosave advances its save-timestamp
# unconditionally, so a save path that stops producing files ticks on silently —
# it did exactly that for 3.5 weeks before a crash found no session to restore.
# This lib turns "when was the newest save actually written" into a visible
# state, so the status pill reddens and the keepalive nags within 15 min instead
# of failing invisibly. The keepalive (resurrect-keepalive.sh) is the driver;
# this lib is the shared detector for both the pill and the keepalive's alarm.
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# mem-lib's mem_state_colour convention.

# Thresholds — defined once. AGING = the save is older than one save interval
# (continuum + keepalive both run every 5 min, so a healthy newest save is
# under ~5 min old; 10 min means one cycle was missed). STALE = two-plus cycles
# missed — the loud line the whole incident lacked. Overridable for tests.
RESURRECT_AGING_SECS=${RESURRECT_AGING_SECS:-600}
RESURRECT_STALE_SECS=${RESURRECT_STALE_SECS:-900}

# Sentinel age when no save file exists at all (NONE): larger than any real age
# so state maps to NONE without a separate flag.
RESURRECT_NONE_AGE=999999999

# resurrect_dir — the plugin's default save dir, replicating helpers.sh's logic:
# ~/.tmux/resurrect if present, else $XDG_DATA_HOME/tmux/resurrect (falling back
# to ~/.local/share). A custom @resurrect-dir is not read here — these dotfiles
# don't set one, and the lib must run without a tmux server (from launchd).
resurrect_dir() {
	if [ -d "$HOME/.tmux/resurrect" ]; then
		echo "$HOME/.tmux/resurrect"
	else
		echo "${XDG_DATA_HOME:-$HOME/.local/share}/tmux/resurrect"
	fi
}

# _resurrect_mtime FILE — epoch mtime of FILE, portable across GNU and BSD stat.
# This host's stat is nix GNU coreutils, where `-f %m` errors; a BSD stat needs
# `-f %m` and rejects `-c`. Try GNU first, fall back to BSD — mirroring the
# GNU/BSD split in resurrect-strip-nix-paths.sh. `-L` follows symlinks so the
# `last` symlink contributes its *target's* mtime (the save's real age), not the
# symlink's own creation time. 0 if the file is gone / the link dangles.
_resurrect_mtime() {
	stat -L -c %Y "$1" 2>/dev/null || stat -L -f %m "$1" 2>/dev/null || echo 0
}

# resurrect_newest_age_secs — seconds since the newest save file was written.
# RESURRECT_NONE_AGE when no save exists. tmux-resurrect only keeps a timestamped
# file when the session state changed since the previous save, so this is the age
# of the last *content-changing* save — which is exactly what went stale in the
# incident.
#
# Fast path is the `last` symlink: tmux-resurrect repoints it at the newest save
# on every write, and it freezes the moment saving stops — precisely the
# staleness signal — so its (dereferenced) target mtime is authoritative. Statting
# it alone keeps render O(1) regardless of how many saves have piled up in the dir
# (1700+ in practice), instead of forking a stat per file every render — the cause
# of a ~12 s status-right that tmux rendered as "<… not ready>". The full glob is
# kept only as the fallback for when `last` is absent or dangling (fresh dir, or a
# prune that left just timestamped files).
resurrect_newest_age_secs() {
	_dir=$(resurrect_dir)
	_newest_mtime=0
	# -e follows the link, so a dangling `last` falls through to the glob below.
	if [ -e "$_dir/last" ]; then
		_newest_mtime=$(_resurrect_mtime "$_dir/last")
	fi
	if [ "${_newest_mtime:-0}" -eq 0 ] 2>/dev/null; then
		_newest_mtime=0
		for _f in "$_dir"/tmux_resurrect_*.txt; do
			[ -e "$_f" ] || continue
			_m=$(_resurrect_mtime "$_f")
			[ "$_m" -gt "$_newest_mtime" ] 2>/dev/null && _newest_mtime=$_m
		done
	fi
	if [ "$_newest_mtime" -eq 0 ]; then
		echo "$RESURRECT_NONE_AGE"
		return
	fi
	_now=$(date +%s)
	echo $((_now - _newest_mtime))
}

# resurrect_state — map newest-save age → FRESH | AGING | STALE | NONE. Mirrors
# mem_state: NONE (no save at all) and STALE (>= stale line) both alarm; AGING is
# the amber warning band; FRESH is healthy.
resurrect_state() {
	_age=$(resurrect_newest_age_secs)
	if [ "$_age" -ge "$RESURRECT_NONE_AGE" ]; then
		echo NONE
	elif [ "$_age" -ge "$RESURRECT_STALE_SECS" ]; then
		echo STALE
	elif [ "$_age" -ge "$RESURRECT_AGING_SECS" ]; then
		echo AGING
	else
		echo FRESH
	fi
}

# resurrect_state_colour STATE — bare 6-hex catppuccin colour. FRESH green,
# AGING yellow, STALE + NONE red (no recent save is the alarm either way).
# Unknown → green (fail quiet). Rendered on the pill's own surface1 pill, not the
# bar bg, matching mem_state_colour's contrast note.
resurrect_state_colour() {
	case "$1" in
	FRESH) echo a6e3a1 ;;
	AGING) echo f9e2af ;;
	STALE) echo f38ba8 ;;
	NONE) echo f38ba8 ;;
	*) echo a6e3a1 ;;
	esac
}

# resurrect_state_glyph STATE — shape per STATE so the signal survives a colour
# clash and reads for colour-blind use (triple-encoding: colour + glyph +
# token). ⟳ = a save cycle is turning (FRESH/AGING, distinguished by colour); ⚠
# = something is wrong (STALE/NONE). Unknown → ⟳.
resurrect_state_glyph() {
	case "$1" in
	FRESH) echo "⟳" ;;
	AGING) echo "⟳" ;;
	STALE) echo "⚠" ;;
	NONE) echo "⚠" ;;
	*) echo "⟳" ;;
	esac
}

# resurrect_human_age SECS — compact human age: Nd / Nh / Nm / Ns. The shared
# formatter for the token and the keepalive's nag.
resurrect_human_age() {
	awk -v s="${1:-0}" 'BEGIN {
		if (s >= 86400) printf "%dd", s / 86400
		else if (s >= 3600) printf "%dh", s / 3600
		else if (s >= 60) printf "%dm", s / 60
		else printf "%ds", s
	}'
}

# resurrect_token — figure-slot content for the pill: "none" when no save exists,
# "stale" when past the stale line (age is beside the point — it's broken), else
# the human age of the newest save ("2m", "1h") as the live confidence signal.
resurrect_token() {
	case "$(resurrect_state)" in
	NONE) printf 'none' ;;
	STALE) printf 'stale' ;;
	*) resurrect_human_age "$(resurrect_newest_age_secs)" ;;
	esac
}
