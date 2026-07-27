#!/usr/bin/env bash
# copy-pane-info.sh: yank a pane's identity (id · tty · cmd · cwd) to the client
# clipboard (OSC52, works over SSH) plus the tmux buffer (prefix + Y). Fields are
# passed as argv from the binding so tmux expands the formats, not set-buffer
# (whose data arg is taken literally and would store the raw #{...} template).
#
# Usage: copy-pane-info.sh <pane_id> <pane_tty> <pane_current_command> <pane_current_path>
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

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_cmd="${3:-}"
pane_path="${4:-}"

info="$pane_id  tty=$pane_tty  cmd=$pane_cmd  $pane_path"

# tmux buffer (+ -w clipboard where the terminal honours set-clipboard)...
printf '%s' "$info" | tmux load-buffer -w -
# ...and OSC52 to the client tty, the reliable path over SSH (same as copy-mode).
printf '%s' "$info" | "$(dirname "${BASH_SOURCE[0]}")/osc52-copy-to-client.sh"

tmux display-message "Copied $pane_id · $pane_path"
