#!/usr/bin/env bash
# agent-branch-menu.sh: dispatch prefix + Alt+b to the focused agent's branch
# menu. Claude and Codex have different fork CLIs, so keep the menus separate
# after resolving the foreground process.
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

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_path="${3:-}"
pane_pid="${4:-}"

script_dir="$(dirname "${BASH_SOURCE[0]}")"

if [ -n "$(agent_foreground_pid_for_tty "$pane_tty" "claude" "$pane_pid")" ]; then
	exec "$script_dir/claude-branch-menu.sh" "$pane_id" "$pane_tty" "$pane_path" "$pane_pid"
fi

if [ -n "$(agent_foreground_pid_for_tty "$pane_tty" "codex" "$pane_pid")" ]; then
	exec "$script_dir/codex-branch-menu.sh" "$pane_id" "$pane_tty" "$pane_path" "$pane_pid"
fi

tmux display-message "No Claude or Codex in this pane"
