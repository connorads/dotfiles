#!/usr/bin/env bash
# lib-call.sh: call one function from a lib/ file, under a guaranteed bash >= 5.
#
# The libs under lib/ are bash and assert bash >= 5. A zsh caller (agent-teleport)
# cannot source them into its own shell, so it shells out - and a bare `bash -c`
# lands on whatever the caller's PATH supplies, which on macOS is 3.2. Routing
# through this entry point makes the standard re-exec preamble do the pinning, so
# the interpreter candidate list lives in exactly one place and stays under the
# bash5-preamble hk gate.
#
# Usage: lib-call.sh <lib-path> <function> [args...]

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

set -euo pipefail

lib="${1:?lib path required}"
shift
fn="${1:?function name required}"
shift

# shellcheck disable=SC1090
. "$lib"
"$fn" "$@"
