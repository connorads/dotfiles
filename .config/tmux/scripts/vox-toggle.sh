#!/usr/bin/env bash
# vox-toggle.sh — prefix + Alt+v: start or stop a recording with one key.
#
# The cheap key belongs to the act you do most. Starting and stopping used to be
# reachable only by typing `vox` / `vox stop` in a pane, while the rare journey
# (browsing old recordings) had the binding; prefix + Alt+Shift+V now owns that.
#
#   idle / ready / transcribing   start a capture, then prompt for a title
#   recording                     stop, and transcribe in the background
#
# Pressed while a transcription is running it starts a new capture: transcription
# is per-directory and detached, so the two never contend.
#
# Two orderings are deliberate:
#
#   Capture starts BEFORE the prompt appears, and the title is applied with `vox
#   rename` afterwards. Same prompt, no lost audio, and escaping the prompt
#   leaves the recording running rather than reading as "cancel" — which is why
#   the prompt says "recording".
#
#   Stopping DETACHES. `vox stop` is synchronous by contract (so
#   `cat "$(vox stop)/transcript.md"` still works), and a key press has nowhere
#   to put the minutes of transcription that follow. The pill covers the wait.
#
#   vox-toggle.sh [PANE]               # the binding's entry point
#   vox-toggle.sh prompt DIR [CLIENT]  # the title prompt, also the menu's Name…
#   vox-toggle.sh name DIR TITLE       # internal: the command-prompt's callback
#   vox-toggle.sh finish DIR PANE      # internal: the detached stop
# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

set -uo pipefail

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SELF="$SELF_DIR/${0##*/}"
# The tmux server's PATH does not carry ~/.local/bin, so resolve the command
# rather than assuming the run-shell inherited it.
VOX_BIN=${VOX_BIN:-$HOME/.local/bin/vox}
# shellcheck source=/dev/null
. "$SELF_DIR/vox-lib.sh"
# ring_bell: the canonical "write BEL to the session's client ttys" helper, so
# the outer terminal marks the window the same way a blocked agent does.
# shellcheck source=/dev/null
. "$SELF_DIR/agent-state-lib.sh"

note() { tmux display-message "$1" 2>/dev/null || true; }

# raise_prompt DIR [CLIENT] — the title question, asked in one place. The pill
# menu's Name… row asks the same thing and reaches it through the `prompt`
# subcommand, so the wording, the flags and the callback have a single owner.
#
# The prompt appears over a capture that is already running, so escaping it
# costs nothing. %% is tmux's substitution for what you typed. CLIENT is the one
# that pressed the key or clicked the pill, so with several clients attached the
# question lands where it was asked for.
raise_prompt() {
	local dir=$1 client=${2:-}
	# -l: `-p` splits on commas into a *sequence* of prompts, so without it this
	# wording asks twice and the second question eats your keys.
	local -a cmd=(command-prompt -l -p 'title (recording, empty = none)')
	[ -n "$client" ] && cmd+=(-t "$client")
	# If no client can be prompted the recording is still running, and saying so
	# beats reporting the start as failed.
	tmux "${cmd[@]}" "run-shell '\"$SELF\" name \"$dir\" \"%%\"'" 2>/dev/null ||
		note "vox: recording ${dir##*/}"
}

# prompt DIR [CLIENT] — the menu's door to the same question.
if [ "${1:-}" = prompt ]; then
	[ -n "${2:-}" ] || exit 0
	raise_prompt "$2" "${3:-}"
	exit 0
fi

# name DIR TITLE — the command-prompt callback. An empty title is the common
# case (you pressed enter), and means "leave it at the timestamp".
if [ "${1:-}" = name ]; then
	dir=${2:-}
	shift 2 || true
	title="$*"
	[ -n "$dir" ] || exit 0
	[ -n "$title" ] || exit 0
	if new=$("$VOX_BIN" rename "$dir" "$title" 2>/dev/null); then
		note "vox: recording ${new##*/}"
	else
		note "vox: could not rename ${dir##*/}"
	fi
	exit 0
fi

# finish DIR PANE — the detached stop. `vox stop` writes its own job statefile,
# so the pill says TRANSCRIBING for as long as this runs; all that is left here
# is telling you how it went.
if [ "${1:-}" = finish ]; then
	dir=${2:-}
	pane=${3:-}
	if "$VOX_BIN" stop >/dev/null 2>&1; then
		note "vox: transcript ready — ${dir##*/}"
		[ -n "$pane" ] && ring_bell "$pane"
	else
		# No READY on failure: the recording is still listed in the picker,
		# which says "No transcript yet" honestly, and the log names itself.
		note "vox: transcription failed — see ${dir}/vox.log"
	fi
	exit 0
fi

pane=${1:-}

if [ "$(vox_state)" = RECORDING ]; then
	dir=$(vox_dir)
	note "vox: stopping ${dir##*/} — transcribing…"
	# setsid-less detach: run-shell waits for its child, and a minutes-long
	# transcription must not hold the server's command queue.
	nohup "$SELF" finish "$dir" "$pane" >/dev/null 2>&1 &
	exit 0
fi

# Start, keeping stdout (the path) and stderr (the diagnostic) apart: vox
# refuses to start when system audio is unavailable, and that reason is the
# whole message.
err=$(mktemp)
if dir=$("$VOX_BIN" 2>"$err"); then
	rm -f "$err"
	raise_prompt "$dir"
else
	note "vox: $(tail -1 "$err")"
	rm -f "$err"
	exit 1
fi
