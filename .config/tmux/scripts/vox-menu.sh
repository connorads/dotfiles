#!/usr/bin/env bash
# vox-menu.sh — the menu behind a click on the recording pill.
#
# Rows match the state, because a menu offering Stop with nothing to stop is
# exactly the drift this subsystem's one-lib rule exists to prevent:
#
#   RECORDING      Stop · Name… · Discard (confirmed) · Recordings
#   TRANSCRIBING   Recordings
#   READY          Recordings
#
# Discard is `vox cancel`: it throws the audio away without spending minutes
# transcribing it, so it is the only destructive row and the only confirmed one.
#
# Name… hands the title question to `vox-toggle.sh prompt`, the key's own owner
# of it, rather than re-spelling a command-prompt here — same wording, same
# flags, one place to get them right.
#
#   vox-menu.sh CLIENT MOUSE_X MOUSE_Y
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
VOX_BIN=${VOX_BIN:-$HOME/.local/bin/vox}
TOGGLE="$SELF_DIR/vox-toggle.sh"
POPUP="$SELF_DIR/vox-popup.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/vox-lib.sh"

client=${1:-}
mx=${2:-C}
my=${3:-C}

state=$(vox_state)
dir=$(vox_dir)
title=" vox: $(printf '%s' "$state" | tr '[:upper:]' '[:lower:]') "

menu=(display-menu -O)
[ -n "$client" ] && menu+=(-c "$client")
menu+=(-x "$mx" -y "$my" -T "$title")

if [ "$state" = RECORDING ]; then
	menu+=(
		"Stop and transcribe" s "run-shell '\"$TOGGLE\"'"
		"Name…" n "run-shell '\"$TOGGLE\" prompt \"$dir\" \"$client\"'"
		""
		"Discard without transcribing" d "confirm-before -p 'discard this recording? (y/n)' \"run-shell '\\\"$VOX_BIN\\\" cancel'\""
		""
	)
fi
menu+=("Recordings…" r "display-popup -E -h 80% -w 80% '$POPUP'")

tmux "${menu[@]}"
