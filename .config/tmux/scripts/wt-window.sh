#!/usr/bin/env bash
# wt-window.sh: worktree ↔ tmux window glue (prefix + Alt+w / Alt+Shift+W).
# Windows are the workspace unit: one worktree per window, tab labelled by
# cwd basename. Subcommands:
#   open <path>   focus the window whose pane cwd is <path> (or inside it),
#                 else open a new window there
#   new <branch>  wt-add <branch> in $PWD's repo (popup shows setup output),
#                 then open a window in the worktree
#   pick          fzf over managed worktrees (wt-status --all) → open
set -euo pipefail

# wt-add / wt-status are dual-mode zsh functions exposed via ~/.local/bin;
# the tmux server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

self="${BASH_SOURCE[0]}"

# Popup-friendly soft failure: show the message, wait for a key, exit clean.
soft_fail() {
	printf '%s\n' "$1" >&2
	printf 'Press any key…' >&2
	read -rsn1 || true
	exit 0
}

cmd="${1:-}"
case "$cmd" in
open)
	path="${2:?path required}"
	# Match a pane cwd equal to the worktree path or inside it (path-boundary
	# "$path/" prefix, never a bare prefix: repo/foo must not match repo/foobar).
	target=$(tmux list-panes -a -F '#{window_id}	#{pane_current_path}' |
		awk -F'\t' -v p="$path" '$2 == p || index($2, p "/") == 1 { print $1; exit }')
	if [ -n "$target" ]; then
		tmux switch-client -t "$target"
		tmux select-window -t "$target"
	else
		tmux new-window -c "$path"
	fi
	;;
new)
	branch="${2:-}"
	[ -n "$branch" ] || soft_fail "usage: wt-window.sh new <branch>"
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	tmux new-window -c "$path"
	;;
pick)
	line=$(wt-status --all --json |
		jq -r '.[] | [.path, .branch + (if .dirty then " [dirty]" else "" end)] | @tsv' |
		fzf --reverse --header='Worktree → window' --delimiter='\t' --with-nth=2..) || exit 0
	path="${line%%	*}"
	[ -n "$path" ] && exec "$self" open "$path"
	;;
*)
	echo "usage: wt-window.sh open <path> | new <branch> | pick" >&2
	exit 1
	;;
esac
