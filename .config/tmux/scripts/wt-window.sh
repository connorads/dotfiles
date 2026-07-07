#!/usr/bin/env bash
# wt-window.sh: worktree ↔ tmux window glue (prefix + Alt+w / Alt+Shift+W).
# A worktree defaults to its own window (tab labelled by cwd basename), but
# placement is the caller's choice: both surfaces also offer "pane here".
# Subcommands:
#   open <path>   focus the window whose pane cwd is <path> (or inside it),
#                 else open a new window there
#   pane <path>   split the summoning pane, new pane cd'd to <path>
#   new <branch>  wt-add <branch> in $PWD's repo (popup shows setup output),
#                 then [enter] new window · [v] pane here
#   pick          fzf over managed worktrees (wt-status --all): enter → open,
#                 ctrl-v → pane here
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
pane)
	path="${2:?path required}"
	# A popup doesn't change which pane is active, so querying from inside one
	# returns the summoning pane; #{pane_id} in the keybind would arrive
	# verbatim (see the skl pick note in tmux.conf).
	origin=$(tmux display-message -p '#{pane_id}')
	tmux split-window -h -t "$origin" -c "$path"
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
	printf 'worktree ready: %s\n[enter] new window · [v] pane here ' "$path" >&2
	read -rsn1 key || key=''
	case "$key" in
	v | V) exec "$self" pane "$path" ;;
	*) tmux new-window -c "$path" ;;
	esac
	;;
pick)
	out=$(wt-status --all --json |
		jq -r '.[] | [.path, .branch + (if .dirty then " [dirty]" else "" end)] | @tsv' |
		fzf --reverse --header='enter: window · ctrl-v: pane here' \
			--delimiter='\t' --with-nth=2.. --expect=ctrl-v) || exit 0
	key="${out%%$'\n'*}"
	line="${out#*$'\n'}"
	path="${line%%	*}"
	[ -n "$path" ] || exit 0
	case "$key" in
	ctrl-v) exec "$self" pane "$path" ;;
	*) exec "$self" open "$path" ;;
	esac
	;;
*)
	echo "usage: wt-window.sh open <path> | pane <path> | new <branch> | pick" >&2
	exit 1
	;;
esac
