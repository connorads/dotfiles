#!/usr/bin/env bash
# context-menu.sh: delegate right-click menus and host worktree popup actions.
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
