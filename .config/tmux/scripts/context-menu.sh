#!/usr/bin/env bash
# context-menu.sh: delegate right-click menus and host worktree popup actions.
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

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# wt-* are dual-mode zsh functions exposed via ~/.local/bin; the tmux server's
# PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

wait_key() {
	printf '\nPress any key…'
	read -rsn1 || true
}

case "${1:-}" in
pane)
	exec "$dir/organiser.sh" pane "" "${2:?pane_id required}" "${3:-C}" "${4:-C}"
	;;
window)
	exec "$dir/organiser.sh" window "" "${2:?window_id required}" "${3:?active pane required}" "${4:-}" "${5:-C}" "${6:-C}"
	;;
session)
	exec "$dir/organiser.sh" session "" "${2:-C}" "${3:-C}"
	;;
wt-publish)
	cwd="${2:?path required}"
	wt-publish --pr "$cwd" || printf 'wt-publish failed\n' >&2
	wait_key
	;;
wt-finish)
	win="${2:?window_id required}"
	cwd="${3:?path required}"
	if wt-finish --mode local "$cwd"; then
		tmux kill-window -t "$win"
	else
		printf 'wt-finish failed - window left open\n' >&2
		wait_key
	fi
	;;
wt-remove)
	win="${2:?window_id required}"
	cwd="${3:?path required}"
	if wt-remove "$cwd"; then
		tmux kill-window -t "$win"
	else
		printf 'wt-remove failed - window left open\n' >&2
		wait_key
	fi
	;;
*)
	echo "usage: context-menu.sh pane <pane_id> <mx> <my> | window <window_id> <active_pane> <cwd> <mx> <my> | session <mx> <my> | wt-publish <cwd> | wt-finish|wt-remove <window_id> <cwd>" >&2
	exit 1
	;;
esac
