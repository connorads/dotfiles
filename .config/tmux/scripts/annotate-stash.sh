#!/usr/bin/env bash
# annotate-stash.sh — the copy-mode `a` capture key. Reads the selection on
# stdin (tmux `copy-pipe` hands it over that way), stashes it, and reports the
# result on the status line.
#
#   annotate-stash.sh <pane-id> <cwd>
#
# Provenance comes in as arguments because `copy-pipe` format-expands its
# command string and `#{pane_id}` there resolves to the pane the selection was
# made in. The two obvious alternatives are both wrong: `$TMUX_PANE` is not set
# for a copy-pipe child (the server spawns it, not the pane) and leaks a stale
# inherited value, and querying `display-message -p '#{pane_id}'` from inside
# the child returns the *active* pane, which is only incidentally the source.
#
# Never fails the keypress. A stash that cannot run says so on the status line
# and exits 0 - an error dialog mid-review is worse than a lost capture.
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

set -uo pipefail

PANE=${1:-}
CWD=${2:-}

# The tmux server's PATH does not carry ~/.local/bin, so resolve the command
# rather than assuming the copy-pipe child inherited it.
ANNOTATE_BIN=${ANNOTATE_BIN:-$HOME/.local/bin/annotate}

args=(stash --source selection)
[ -n "$PANE" ] && args+=(--pane "$PANE")
[ -n "$CWD" ] && args+=(--cwd "$CWD")

if [ ! -x "$ANNOTATE_BIN" ]; then
	tmux display-message "annotate: not installed"
	exit 0
fi

# stdin is the selection. Capture the report so it can go to the status line;
# stderr carries the failure text for the same purpose.
report=$("$ANNOTATE_BIN" "${args[@]}" 2>&1) || true
[ -n "$report" ] || report="annotate: nothing stashed"

tmux display-message "$report"
exit 0
