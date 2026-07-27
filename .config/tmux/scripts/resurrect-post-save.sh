#!/usr/bin/env bash
# resurrect-post-save.sh: post-save maintenance hook for tmux-resurrect
# Runs companion maintenance steps independently so one failure cannot suppress
# the other, while keeping tmux-resurrect's layout save non-fatal.

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

SAVE_FILE="${1:-}"
SELF_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
LOG="${RESURRECT_POST_SAVE_LOG:-$HOME/.cache/tmux-resurrect-post-save.log}"

log_warn() {
	local message="$1"

	mkdir -p "$(dirname "$LOG")"
	printf '%s WARN %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$message" >>"$LOG"
}

run_step() {
	local name="$1"
	local script="$SELF_DIR/$name"
	local rc

	"$script" "$SAVE_FILE"
	rc=$?
	if [ "$rc" -ne 0 ]; then
		log_warn "$name failed rc=$rc save=$SAVE_FILE"
	fi
}

if [ -z "$SAVE_FILE" ]; then
	log_warn "missing save file path"
	exit 0
fi

if [ ! -f "$SAVE_FILE" ]; then
	log_warn "save file does not exist path=$SAVE_FILE"
	exit 0
fi

run_step resurrect-strip-nix-paths.sh
run_step resurrect-save-sessions.sh

exit 0
