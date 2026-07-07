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
#   pick          fzf over managed worktrees (wt-status --all): repo + status
#                 columns (open/dirty/merged/ahead/behind) with a git log +
#                 status preview; enter → open, ctrl-v → pane here,
#                 ctrl-x → remove (wt-remove --delete-branch: merged branch
#                 deleted, unmerged kept)
set -euo pipefail

# wt-add / wt-status are dual-mode zsh functions exposed via ~/.local/bin;
# the tmux server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

self="${BASH_SOURCE[0]}"

# Popup-friendly notice: show the message, wait for a key, carry on.
pause_msg() {
	printf '%s\n' "$1" >&2
	printf 'Press any key…' >&2
	read -rsn1 || true
}

# Popup-friendly soft failure: pause_msg, then exit clean.
soft_fail() {
	pause_msg "$1"
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
	# Rows: path (hidden), repo (path component after ~/.trees), branch, then
	# marker fields: dirty/untracked, merged into base, ahead/behind of
	# upstream. Markers are information, not guards - removal deletes only
	# branches already merged into base (git branch -d), so removing a clean
	# tree loses nothing.
	rows=$(wt-status --all --json |
		jq -r '.[] | [.path,
			((.path | split("/.trees/")[1] // "") | split("/")[0]),
			.branch,
			(if .dirty or .untracked then "dirty" else "" end),
			(if .merged_into_base then "merged" else "" end),
			(if .ahead > 0 then "ahead \(.ahead)" else "" end),
			(if .behind > 0 then "behind \(.behind)" else "" end)] | @tsv' |
		sort -t'	' -k2,2 -k3,3)
	[ -n "$rows" ] || soft_fail 'No managed worktrees - prefix + Alt+w creates one'
	panes=$(tmux list-panes -a -F '#{window_id}	#{pane_current_path}')
	# Render display columns; "open" marks a live pane at or inside the
	# worktree (same path-boundary match as the open subcommand).
	display=$(printf '%s\n' "$rows" | PANES="$panes" awk '
		BEGIN {
			FS = "\t"
			# Marker colours by field: dirty red, merged green, ahead yellow,
			# behind magenta; the pane-scan "open" is blue.
			col[4] = 31; col[5] = 32; col[6] = 33; col[7] = 35
			np = split(ENVIRON["PANES"], pl, "\n")
			for (i = 1; i <= np; i++) {
				split(pl[i], pf, "\t")
				if (pf[2] != "") pc[++pn] = pf[2]
			}
		}
		$1 == "" { next }
		{
			m = ""
			for (i = 1; i <= pn; i++)
				if (pc[i] == $1 || index(pc[i], $1 "/") == 1) {
					m = "\033[34mopen\033[0m"
					break
				}
			for (f = 4; f <= NF; f++)
				if ($f != "")
					m = m (m == "" ? "" : " ") "\033[" col[f] "m" $f "\033[0m"
			nr++
			paths[nr] = $1; repos[nr] = $2; branches[nr] = $3; marks[nr] = m
			if (length($2) > rw) rw = length($2)
			if (length($3) > bw) bw = length($3)
		}
		END {
			fmt = "%s\t%-" rw "s  %-" bw "s  %s\n"
			for (i = 1; i <= nr; i++)
				printf fmt, paths[i], repos[i], branches[i], marks[i]
		}')
	out=$(printf '%s\n' "$display" |
		fzf --reverse --ansi \
			--header='enter: window · ctrl-v: pane here · ctrl-x: remove' \
			--delimiter='\t' --with-nth=2.. --expect=ctrl-v,ctrl-x \
			--preview 'git -C {1} log --oneline --decorate -10; echo; git -C {1} status --short') || exit 0
	key="${out%%$'\n'*}"
	line="${out#*$'\n'}"
	path="${line%%	*}"
	[ -n "$path" ] || exit 0
	case "$key" in
	ctrl-v) exec "$self" pane "$path" ;;
	ctrl-x)
		# Two guards only: an open pane (removing under a live shell leaves a
		# dead pane) and wt-remove's own dirty/untracked refusal. Branch
		# deletion is git branch -d via --delete-branch: merged branches
		# (commits already in base) go, unmerged ones survive with a warning.
		if tmux list-panes -a -F '#{window_id}	#{pane_current_path}' |
			awk -F'\t' -v p="$path" \
				'$2 == p || index($2, p "/") == 1 { f = 1; exit } END { exit !f }'; then
			pause_msg "Worktree has an open pane - close it first: $path"
		elif ! wt-remove --delete-branch "$path" >/dev/null; then
			pause_msg "wt-remove refused (see above): $path"
		fi
		exec "$self" pick
		;;
	*) exec "$self" open "$path" ;;
	esac
	;;
*)
	echo "usage: wt-window.sh open <path> | pane <path> | new <branch> | pick" >&2
	exit 1
	;;
esac
