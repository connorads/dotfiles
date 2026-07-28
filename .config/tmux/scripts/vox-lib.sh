#!/bin/sh
# vox-lib.sh — shared recording vocabulary for the vox subsystem. Sourced
# (never executed) so the `vox` command, the picker popup and the status pill
# speak one language — IDLE | RECORDING, one colour/glyph/token set — defined
# once here. Mirrors caffeine-lib.sh / mem-lib.sh's one-lib-many-surfaces role.
#
# What it drives: `vox` runs one detached ffmpeg capturing the mic and the
# system-audio loopback to two WAVs, then transcribes each locally with the
# MacWhisper CLI. State is that single capture process, tracked by a statefile
# holding "pid start_epoch dir" so a recording is never silently left running.
#
# The statefile is the only state: a dead pid reads IDLE, so the state
# self-clears without a reaper (as caffeine-lib's pidfile does).
#
# It also owns the two *pure text parsers* the capture path needs — audio device
# index and track loudness. Both take command output on stdin rather than
# touching hardware, so every branch is testable without a microphone.
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# mem_state_colour / caffeine_state_colour.

# Statefile holding "pid start_epoch dir". Env-overridable so bats can redirect
# it to an isolated HOME without spawning a real capture.
VOX_STATEFILE=${VOX_STATEFILE:-$HOME/.cache/tmux-vox.state}

# Recording store root. One directory per recording, named
# "YYYY-MM-DD-HHMMSS-slug" — the directory name IS the title, so renaming is
# `mv` and nothing can drift out of sync. Only the timestamp prefix is parsed.
VOX_STORE=${VOX_STORE:-$HOME/Recordings/vox}

# RECORDING pill colour — catppuccin subtext0, the muted data-pill foreground
# shared with disk/git, on surface1. Deliberately *not* a bright accent: the
# pill is visible during screen shares, so it must read as ambient chrome
# rather than an alarm. Still clears WCAG AA on #45475a.
VOX_COLOUR=a6adc8

# RECORDING glyph — plain ASCII tilde. Zero rendering risk (no emoji
# presentation, no ambiguous-width trap of the kind caffeine-lib documents for
# ☕), and it collides with no existing vocabulary: mem ⬡⊟⊠, resurrect ⟳⚠,
# agent dots ◆◐●○·, caffeine ☼. Quoted so the assignment does not tilde-expand.
VOX_GLYPH="${VOX_GLYPH:-~}"

# Mean-volume floor, in dBFS, below which a track counts as silent. A truly
# silent BlackHole capture measures about -91 dB, so -50 is a wide margin.
VOX_SILENCE_DB=${VOX_SILENCE_DB:--50}

# vox_read_state — load the statefile into _vox_pid / _vox_start / _vox_dir.
# Returns 1 (with the fields zeroed) when there is no statefile. `read` with
# three names puts the whole remainder in the last, so a directory containing
# spaces survives.
vox_read_state() {
	_vox_pid=""
	_vox_start=0
	_vox_dir=""
	[ -f "$VOX_STATEFILE" ] || return 1
	IFS=' ' read -r _vox_pid _vox_start _vox_dir <"$VOX_STATEFILE" || return 1
	: "${_vox_start:=0}"
	return 0
}

# vox_pid — the capture pid, empty when there is no statefile.
vox_pid() {
	vox_read_state || true
	printf '%s' "$_vox_pid"
}

# vox_dir — the directory the live capture is writing into, empty when idle.
vox_dir() {
	vox_read_state || true
	printf '%s' "$_vox_dir"
}

# vox_active — true when the recorded pid is a live process. A stale statefile
# (ffmpeg crashed, or the machine rebooted) reads as inactive, so the state
# self-clears without a separate reaper.
vox_active() {
	vox_read_state || return 1
	[ -n "$_vox_pid" ] || return 1
	kill -0 "$_vox_pid" 2>/dev/null
}

# vox_state — RECORDING while the capture is live, else IDLE.
vox_state() {
	if vox_active; then
		echo RECORDING
	else
		echo IDLE
	fi
}

# vox_elapsed_secs — seconds since the capture started; 0 when idle or when the
# statefile carries no usable start epoch. Never negative (a clock step back
# clamps to 0 rather than rendering a nonsense age).
vox_elapsed_secs() {
	vox_read_state || {
		echo 0
		return
	}
	case "${_vox_start:-}" in
	'' | *[!0-9]*)
		echo 0
		return
		;;
	esac
	_vox_now=$(date +%s)
	_vox_el=$((_vox_now - _vox_start))
	[ "$_vox_el" -lt 0 ] && _vox_el=0
	echo "$_vox_el"
}

# vox_human_age SECS — compact human age: Nd / Nh / Nm / Ns. The shared token
# formatter, identical to caffeine_human_age / resurrect_human_age. Elapsed is
# rendered this way (not mm:ss) because status-interval is 15 s, so a seconds
# clock would tick in 15 s jumps and read as broken.
vox_human_age() {
	awk -v s="${1:-0}" 'BEGIN {
		if (s >= 86400) printf "%dd", s / 86400
		else if (s >= 3600) printf "%dh", s / 3600
		else if (s >= 60) printf "%dm", s / 60
		else printf "%ds", s
	}'
}

# vox_state_colour STATE — bare 6-hex pill colour. Only RECORDING is rendered
# (IDLE self-hides); the signature stays parallel to the other libs.
vox_state_colour() {
	case "$1" in
	*) printf '%s' "$VOX_COLOUR" ;;
	esac
}

# vox_state_glyph STATE — the pill glyph. Parallel signature to the other libs.
vox_state_glyph() {
	case "$1" in
	*) printf '%s' "$VOX_GLYPH" ;;
	esac
}

# vox_token — figure-slot content: how long the capture has been running.
vox_token() {
	vox_human_age "$(vox_elapsed_secs)"
}

# vox_write_state PID START_EPOCH DIR — record a live capture.
vox_write_state() {
	mkdir -p "$(dirname "$VOX_STATEFILE")"
	printf '%s %s %s\n' "$1" "$2" "$3" >"$VOX_STATEFILE"
}

# vox_clear_state — drop the statefile.
vox_clear_state() {
	rm -f "$VOX_STATEFILE" 2>/dev/null || true
}

# vox_audio_device_index NAME — read `ffmpeg -f avfoundation -list_devices true`
# output on stdin and print the index of the first *audio* device whose name
# contains NAME; print nothing (and return 1) when there is no match.
#
# Pure over text so device resolution is testable with a captured listing and no
# audio hardware. Resolving by name is load-bearing: avfoundation indices shift
# whenever a device appears or disappears (connecting AirPods renumbers
# everything), so a recorded index would silently capture the wrong input.
#
# The listing carries a video section first, with its own indices from 0, so the
# section header gates matching. Every line is prefixed "[AVFoundation indev @
# 0x...]", which never matches the all-digits bracket the index uses.
vox_audio_device_index() {
	awk -v want="$1" '
		/AVFoundation video devices:/ { audio = 0; next }
		/AVFoundation audio devices:/ { audio = 1; next }
		!audio { next }
		match($0, /\[[0-9]+\] /) {
			idx = substr($0, RSTART + 1, RLENGTH - 3)
			name = substr($0, RSTART + RLENGTH)
			if (index(name, want)) { print idx; found = 1; exit }
		}
		END { if (!found) exit 1 }
	'
}

# vox_mean_volume — read `ffmpeg -af volumedetect` output on stdin and print the
# mean_volume in dBFS (e.g. "-91.0"); print nothing and return 1 when the
# measurement is absent. Pure over text, like vox_audio_device_index.
vox_mean_volume() {
	awk '
		/mean_volume:/ {
			for (i = 1; i < NF; i++) if ($i == "mean_volume:") { val = $(i + 1); found = 1 }
		}
		END { if (!found) exit 1; print val }
	'
}

# vox_classify_track — read `ffmpeg -af volumedetect` output for the *system*
# track on stdin and print MONOLOGUE (silent — nobody else was on the call) or
# MEETING (audible). Silence is the classifier, not an error: it is what removes
# any need to declare a mode when starting. An unmeasurable track reads
# MONOLOGUE, the conservative reading (a missing other side, not a fabricated
# one).
vox_classify_track() {
	_vox_mean=$(vox_mean_volume) || {
		echo MONOLOGUE
		return
	}
	awk -v mean="$_vox_mean" -v floor="$VOX_SILENCE_DB" 'BEGIN {
		print (mean + 0 > floor + 0) ? "MEETING" : "MONOLOGUE"
	}'
}
