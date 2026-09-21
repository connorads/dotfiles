#!/usr/bin/env bash
# vox-toggle.sh — prefix + Alt+v: start or stop a recording with one key.
#
# The cheap key belongs to the act you do most. Starting and stopping used to be
# reachable only by typing `vox` / `vox stop` in a pane, while the rare journey
# (browsing old recordings) had the binding; prefix + Alt+Shift+V now owns that.
#
#   idle / ready / transcribing   prompt for a title while the capture starts
#   recording                     stop, and transcribe in the background
#
# Pressed while a transcription is running it starts a new capture: transcription
# is per-directory and detached, so the two never contend.
#
# Two orderings are deliberate:
#
#   The prompt appears AT ONCE, with the capture starting behind it, and how the
#   prompt is dismissed decides the recording's fate: Esc discards, Enter keeps
#   (a title renames, an empty answer leaves the timestamp). Starting costs a
#   second or more of device setup and gives nothing to look at meanwhile, so
#   asking first is what makes the key feel instant; the answer is only applied
#   once the capture is confirmed live, so no audio is lost to typing.
#
#   Stopping DETACHES. `vox stop` is synchronous by contract (so
#   `cat "$(vox stop)/transcript.md"` still works), and a key press has nowhere
#   to put the minutes of transcription that follow. The pill covers the wait.
#
# The answer travels through a tmux user option, never a shell command line.
# `%%`/`%%%` splice the typed text into the template, tmux parses the result and
# `run-shell` hands it to `sh -c`, so a backtick in a title would execute and a
# single quote would break the command and lose the answer - which, with Esc
# meaning discard, would throw the recording away. `set-option` is parsed by tmux
# alone, and `%%%`'s quote escaping survives that parser for every title tried.
#
# The binding runs this under `run-shell -b`, and a non-zero exit makes tmux
# print `'<cmd>' returned N` after - and over - any display-message the script
# made, so the reason is lost. Every path reports with display-message and
# exits 0; nothing reads the status.
#
#   vox-toggle.sh [PANE]               # the binding's entry point
#   vox-toggle.sh prompt DIR [CLIENT]  # the title prompt, also the menu's Name…
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

# One wording for both doors. What Esc does differs by door - start: discard,
# menu: no rename - and is documented at each; the prompt names neither.
PROMPT='enter name (optional): '

# ask_title PROMPT [CLIENT] — raise the title prompt and wait for its answer.
# Prints the title (possibly empty) and returns 0 when the prompt was answered
# with Enter, 1 when it was escaped, 2 when there was no client to ask.
#
# CLIENT is the one that pressed the key or clicked the pill, so with several
# clients attached the question lands where it was asked for.
#
# No `-b`: without it the CLI returns only once the prompt is dismissed, and
# only after the template has run (measured on 3.7c: the option is set at the
# moment of return, every time), so one read is the whole wait. With `-b` the
# CLI returns at once, whatever the man page says about it, and Esc could not be
# told from a prompt still open. The CLI exits 0 for Esc and Enter alike, so the
# option's presence is the only thing that tells them apart; it is keyed by this
# pid so two prompts can never read each other's answer, and prefixed with a
# character so an empty answer is still an answer.
ask_title() {
	local prompt=$1 client=${2:-} opt="@vox_answer_$$" answer
	# -l: `-p` splits on commas into a *sequence* of prompts, so without it a
	# wording holding a comma asks twice and the second question eats your keys.
	local -a cmd=(command-prompt -l -p "$prompt")
	[ -n "$client" ] && cmd+=(-t "$client")
	tmux "${cmd[@]}" "set-option -g $opt \"x%%%\"" 2>/dev/null || return 2
	answer=$(tmux show-options -gqv "$opt" 2>/dev/null)
	tmux set-option -gu "$opt" 2>/dev/null || true
	[ -n "$answer" ] || return 1
	printf '%s' "${answer#x}"
}

# rename_to DIR TITLE — apply a title to a recording and say how it went.
rename_to() {
	local dir=$1 title=$2 new
	if new=$("$VOX_BIN" rename "$dir" "$title" 2>/dev/null); then
		note "vox: recording ${new##*/}"
	else
		note "vox: could not rename ${dir##*/}"
	fi
}

# prompt DIR [CLIENT] — the menu's door to the title question, over a recording
# that is already running. Escaping it here means "no rename", never discard:
# the capture was not started by this prompt, so it is not this prompt's to end.
if [ "${1:-}" = prompt ]; then
	[ -n "${2:-}" ] || exit 0
	if title=$(ask_title "$PROMPT" "${3:-}") && [ -n "$title" ]; then
		rename_to "$2" "$title"
	fi
	exit 0
fi

# finish DIR PANE — the detached stop. `vox stop` writes its own job statefile,
# so the pill says TRANSCRIBING for as long as this runs; all that is left here
# is telling you how it went.
if [ "${1:-}" = finish ]; then
	dir=${2:-}
	pane=${3:-}
	# The exit status, not just success or not: `vox stop` returns non-zero for a
	# transcript with nothing in it as well as for a transcription that fell over,
	# and announcing either as ready is the lie this replaces.
	"$VOX_BIN" stop >/dev/null 2>&1
	rc=$?
	if [ "$rc" -eq 0 ]; then
		note "vox: transcript ready — ${dir##*/}"
	else
		# One message for both, because the log is what distinguishes them. The
		# picker lists the recording as `empty`, which is the honest label.
		note "vox: no speech transcribed — see ${dir}/vox.log"
	fi
	# The bell either way: a recording that produced nothing needs your attention
	# more than one that worked, not less.
	[ -n "$pane" ] && ring_bell "$pane"
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

# Start: the capture in the background, the prompt in front of it, then one
# decision from the two results. stdout (the path) and stderr (the diagnostic)
# are kept apart because vox refuses to start when system audio is unavailable,
# and that reason is the whole message.
scratch=$(mktemp -d)
"$VOX_BIN" >"$scratch/dir" 2>"$scratch/err" &
start_pid=$!

title=$(ask_title "$PROMPT")
prompt_rc=$?

wait "$start_pid"
start_rc=$?
dir=$(cat "$scratch/dir")
err=$(tail -1 "$scratch/err")
rm -rf "$scratch"

if [ "$start_rc" -ne 0 ]; then
	# Nothing to discard or keep; the prompt, if any, was answered for nothing.
	# vox's own last line already carries the prefix.
	note "$err"
	exit 0
fi

case "$prompt_rc" in
0)
	if [ -n "$title" ]; then
		rename_to "$dir" "$title"
	else
		note "vox: recording ${dir##*/}"
	fi
	;;
1)
	"$VOX_BIN" cancel >/dev/null 2>&1
	note "vox: discarded ${dir##*/}"
	;;
*)
	# No client to ask: the recording is running, and saying so beats reporting
	# the start as failed.
	note "vox: recording ${dir##*/}"
	;;
esac
