#!/bin/sh
# vox-lib.sh — shared recording vocabulary for the vox subsystem. Sourced
# (never executed) so the `vox` command, the picker popup and the status pill
# speak one language — IDLE | RECORDING, one colour/glyph/token set — defined
# once here. Mirrors caffeine-lib.sh / mem-lib.sh's one-lib-many-surfaces role.
#
# What it drives: `vox` runs one detached ffmpeg per source - the mic through
# avfoundation, the system's own output through `voxtap` on a pipe - writing two
# WAVs, then transcribes each locally with the MacWhisper CLI. State is those
# capture processes, tracked by a statefile holding "pids start_epoch dir", where
# pids is a comma-separated list whose FIRST entry is the mic capture, the leader
# that defines whether a recording is running.
#
# Two processes rather than one because a single ffmpeg cannot fairly read two
# real-time inputs whose timestamps start in different epochs: it reads whichever
# is "behind" and starves the other (measured: the mic delivered 2 s of audio in
# 8 s of wall-clock). See docs/adr/0003.
#
# The statefile is the only state: a dead leader pid reads IDLE, so the state
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

# Statefile holding "pids start_epoch dir". Env-overridable so bats can redirect
# it to an isolated HOME without spawning a real capture.
VOX_STATEFILE=${VOX_STATEFILE:-$HOME/.cache/tmux-vox.state}

# Transcribe-job file holding "pid start_epoch dir" — written by `vox stop`
# around the transcription it is about to spend minutes on, so the pill can say
# TRANSCRIBING whether the stop was typed in a pane or detached by the toggle. A
# dead pid reads as not transcribing, so a crashed `mw` needs no reaper either.
VOX_JOBFILE=${VOX_JOBFILE:-$HOME/.cache/tmux-vox.job}

# Marker whose MTIME is the last time you looked at the recordings. READY is
# "the newest transcript is newer than this", which handles any number of
# finished recordings without tracking any of them, and makes touching the
# marker the only write. Cleared by opening the picker, and by starting a new
# capture (you have moved on).
VOX_SEENFILE=${VOX_SEENFILE:-$HOME/.cache/tmux-vox.seen}

# Recording store root. One directory per recording, named
# "YYYY-MM-DD-HHMMSS-slug" — the directory name IS the title, so renaming is
# `mv` and nothing can drift out of sync. Only the timestamp prefix is parsed.
VOX_STORE=${VOX_STORE:-$HOME/Recordings/vox}

# RECORDING pill colour — catppuccin subtext0, the muted data-pill foreground
# shared with disk/git, on surface1. Deliberately *not* a bright accent: the
# pill is visible during screen shares, so it must read as ambient chrome
# rather than an alarm. Still clears WCAG AA on #45475a. TRANSCRIBING shares it:
# it is the same ongoing, uninteresting work.
VOX_COLOUR=a6adc8

# READY pill colour — catppuccin blue, the SAME blue the agent dots use for
# "finished, and you have not looked yet". Reusing it is the point: unread is
# one idea across this config, so a blue pill means the same thing as a blue
# tab dot. It appears only after a capture has stopped, never mid-recording.
VOX_READY_COLOUR=89b4fa

# RECORDING glyph — plain ASCII tilde. Zero rendering risk (no emoji
# presentation, no ambiguous-width trap of the kind caffeine-lib documents for
# ☕), and it collides with no existing vocabulary: mem ⬡⊟⊠, resurrect ⟳⚠,
# agent dots ◆◐●○·, caffeine ☼. Quoted so the assignment does not tilde-expand.
VOX_GLYPH="${VOX_GLYPH:-~}"

# TRANSCRIBING / READY glyphs — narrow, non-emoji, and shaped so the states read
# apart on a colour clash: a wave still moving, then a tick. Neither has an emoji
# presentation form, which is the trap ☕ documents.
VOX_TRANSCRIBING_GLYPH="${VOX_TRANSCRIBING_GLYPH:-≈}"
VOX_READY_GLYPH="${VOX_READY_GLYPH:-✓}"

# Mean-volume floor, in dBFS, below which a track counts as silent.
#
# Measured on this hardware: a system track that captured nothing reads -91 dB
# (digital silence), while a MICROPHONE in a quiet room reads about -55 dB. The
# floor has to sit between them, or `prune --empty` finds every monologue's mic
# track "silent" too and skips the recording as captured-nothing. -70 leaves
# ~20 dB of headroom on both sides.
VOX_SILENCE_DB=${VOX_SILENCE_DB:--70}

# vox_read_state — load the statefile into _vox_pids / _vox_pid / _vox_start /
# _vox_dir. Returns 1 (with the fields zeroed) when there is no statefile. `read`
# with three names puts the whole remainder in the last, so a directory
# containing spaces survives.
vox_read_state() {
	_vox_pids=""
	_vox_pid=""
	_vox_start=0
	_vox_dir=""
	[ -f "$VOX_STATEFILE" ] || return 1
	IFS=' ' read -r _vox_pids _vox_start _vox_dir <"$VOX_STATEFILE" || return 1
	# The leader is the mic capture: it is what "recording" means, and the one
	# whose death makes the state stale.
	_vox_pid=${_vox_pids%%,*}
	: "${_vox_start:=0}"
	return 0
}

# vox_pid — the leading (mic) capture pid, empty when there is no statefile.
vox_pid() {
	vox_read_state || true
	printf '%s' "$_vox_pid"
}

# vox_pids — every capture pid, space-separated, so a caller can signal the set.
vox_pids() {
	vox_read_state || true
	printf '%s' "$(echo "$_vox_pids" | tr ',' ' ')"
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

# vox_read_job — load the transcribe-job file into _vox_job_pid /
# _vox_job_start / _vox_job_dir. Returns 1 (fields zeroed) when there is none.
vox_read_job() {
	_vox_job_pid=""
	_vox_job_start=0
	_vox_job_dir=""
	[ -f "$VOX_JOBFILE" ] || return 1
	IFS=' ' read -r _vox_job_pid _vox_job_start _vox_job_dir <"$VOX_JOBFILE" || return 1
	: "${_vox_job_start:=0}"
	return 0
}

# vox_job_dir — the recording being transcribed, empty when none is.
vox_job_dir() {
	vox_read_job || true
	printf '%s' "$_vox_job_dir"
}

# vox_job_active — true while the transcribe job's pid is alive. A job that died
# (mw crashed, the machine rebooted) reads as finished, so this self-clears the
# same way the capture state does.
vox_job_active() {
	vox_read_job || return 1
	[ -n "$_vox_job_pid" ] || return 1
	kill -0 "$_vox_job_pid" 2>/dev/null
}

# vox_write_job PID START_EPOCH DIR — record a running transcription.
vox_write_job() {
	mkdir -p "$(dirname "$VOX_JOBFILE")"
	printf '%s %s %s\n' "$1" "$2" "$3" >"$VOX_JOBFILE"
}

# vox_clear_job — drop the transcribe-job file.
vox_clear_job() {
	rm -f "$VOX_JOBFILE" 2>/dev/null || true
}

# vox_touch_seen — mark everything as looked-at. One write, no list of what was
# seen: the mtime IS the record.
vox_touch_seen() {
	mkdir -p "$(dirname "$VOX_SEENFILE")"
	: >"$VOX_SEENFILE"
}

# vox_unread_count — transcripts finished since you last looked.
#
# `-size +0` because a failed merge still leaves an empty transcript.md behind,
# and an empty transcript is not something to go and read. With no marker at all
# (a fresh machine) every transcript counts as unread, which one keypress
# clears — the alternative would hide the first recording you ever make.
vox_unread_count() {
	[ -d "$VOX_STORE" ] || {
		echo 0
		return
	}
	if [ -e "$VOX_SEENFILE" ]; then
		find "$VOX_STORE" -maxdepth 2 -name transcript.md -size +0 \
			-newer "$VOX_SEENFILE" 2>/dev/null | wc -l | tr -d ' '
	else
		find "$VOX_STORE" -maxdepth 2 -name transcript.md -size +0 2>/dev/null |
			wc -l | tr -d ' '
	fi
}

# vox_state — RECORDING > TRANSCRIBING > READY > IDLE, in that precedence: the
# same "worst first" shape as the agent dots' rank. Each state is derived from a
# file whose staleness cannot lie (a pid's liveness, an mtime comparison), so
# nothing here needs a reaper.
vox_state() {
	if vox_active; then
		echo RECORDING
	elif vox_job_active; then
		echo TRANSCRIBING
	elif [ "$(vox_unread_count)" -gt 0 ] 2>/dev/null; then
		echo READY
	else
		echo IDLE
	fi
}

# vox_job_elapsed_secs — seconds the current transcription has been running; 0
# when none is.
vox_job_elapsed_secs() {
	vox_read_job || {
		echo 0
		return
	}
	case "${_vox_job_start:-}" in
	'' | *[!0-9]*)
		echo 0
		return
		;;
	esac
	_vox_now=$(date +%s)
	_vox_el=$((_vox_now - _vox_job_start))
	[ "$_vox_el" -lt 0 ] && _vox_el=0
	echo "$_vox_el"
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

# vox_state_colour STATE — bare 6-hex pill colour. IDLE self-hides, so its
# colour is never rendered; the signature stays parallel to the other libs.
vox_state_colour() {
	case "$1" in
	READY) printf '%s' "$VOX_READY_COLOUR" ;;
	*) printf '%s' "$VOX_COLOUR" ;;
	esac
}

# vox_state_glyph STATE — the pill glyph. Parallel signature to the other libs.
vox_state_glyph() {
	case "$1" in
	TRANSCRIBING) printf '%s' "$VOX_TRANSCRIBING_GLYPH" ;;
	READY) printf '%s' "$VOX_READY_GLYPH" ;;
	*) printf '%s' "$VOX_GLYPH" ;;
	esac
}

# vox_token [STATE] — figure-slot content: elapsed while capturing or
# transcribing, and how many transcripts are waiting once one is ready. The
# state is an argument so a caller that already computed it does not pay for it
# twice; omitted, it is derived.
vox_token() {
	_vox_state=${1:-$(vox_state)}
	case "$_vox_state" in
	TRANSCRIBING) vox_human_age "$(vox_job_elapsed_secs)" ;;
	READY) vox_unread_count ;;
	IDLE) printf '' ;;
	*) vox_human_age "$(vox_elapsed_secs)" ;;
	esac
}

# vox_write_state PIDS START_EPOCH DIR — record a live capture. PIDS is the
# comma-separated capture pid list, leader (mic) first.
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

# vox_session_kind DIR — "2-way" when the system track produced transcript
# segments, else "solo".
#
# Derived, never stored: the answer is already on disk in sys.json, so there is
# no metadata file to drift, and a re-transcription updates the label for free. A
# missing or empty system track reads "solo", the conservative call (a missing
# other side, not a fabricated one) — and the one `VOX_MIC_ONLY=1` produces.
vox_session_kind() {
	_vox_sys="$1/sys.json"
	# A POSITIVE test for a segment object, not for the word "text": real mw
	# output carries a TOP-LEVEL "text" key that is present (and empty) even when
	# nothing was transcribed, so looking for the word alone calls every silent
	# system track 2-way. Whitespace is stripped first because mw pretty-prints,
	# so the array and its first brace are on different lines. Anything
	# unrecognisable reads solo, the conservative call.
	if [ -s "$_vox_sys" ] && tr -d ' \t\n' <"$_vox_sys" | grep -q '"segments":\[{'; then
		echo 2-way
	else
		echo solo
	fi
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
