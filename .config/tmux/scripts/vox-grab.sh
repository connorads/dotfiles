#!/usr/bin/env bash
# vox-grab.sh — prefix + Alt+y: copy the live call's transcript so far, to paste
# into an agent without stopping the recording.
#
# `vox grab` owns the transcription and its contract (a path on stdout, exit 0
# only when something was recognised); this only moves the result to the
# clipboard - tmux buffer with -w for terminals that honour set-clipboard, plus
# OSC52 to the client tty, the same pair as the Recordings popup.
#
# Runs under `run-shell -b`: a long call takes seconds to transcribe, and a
# foreground job would hold the client's keys meanwhile. Every path reports
# with display-message and exits 0, since a non-zero exit under -b prints over
# the message.
#
#   vox-grab.sh            # the whole call so far (the key)
#   vox-grab.sh 5m         # its last five minutes (the pill menu)
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
OSC52="$SELF_DIR/osc52-copy-to-client.sh"

window=${1:-}
say() { tmux display-message "$1" 2>/dev/null || true; }

span="the call so far"
[ -n "$window" ] && span="the last $window of the call"
say "vox: transcribing ${span}…"
err=$(mktemp)
trap 'rm -f "$err"' EXIT
path=$("$VOX_BIN" grab ${window:+"$window"} 2>"$err")
rc=$?

if [ "$rc" -ne 0 ] || [ ! -s "$path" ]; then
	reason=$(grep -v '…$' "$err" | tail -n 1)
	say "${reason:-vox: grab failed}"
	exit 0
fi

tmux load-buffer -w "$path" 2>/dev/null || true
[ -x "$OSC52" ] && "$OSC52" <"$path"
# Spoken words only: past the header and its blank line, without each line's
# `[hh:mm:ss] Speaker:` prefix.
words=$(tail -n +3 "$path" | sed 's/^\[[^]]*\] [^:]*: //' | wc -w | tr -d ' ')
say "copied $span · $words words"
