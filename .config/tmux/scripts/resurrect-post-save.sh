#!/usr/bin/env bash
# resurrect-post-save.sh: post-save maintenance hook for tmux-resurrect
# Runs companion maintenance steps independently so one failure cannot suppress
# the other, while keeping tmux-resurrect's layout save non-fatal.

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
