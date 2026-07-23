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
#   pick          fzf over managed worktrees (wt-status --all --pr): columns are
#                 repo, a fixed-width PR-state verdict (✓ reap / ✓ merged /
#                 ○ open / ✗ closed / · - / ? …), branch, then a truncatable
#                 local-flags column (◉ live / ● dirty / ↑ahead / ↓behind).
#                 State is glyph + colour, so it reads without colour and the
#                 verdict survives truncation (fixed column, ahead of branch).
#                 Offline (no gh) degrades to ? with the local merged hint.
#                 git log + status preview; enter → open, ctrl-v → pane here,
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
	# PR state (from --pr), pr number, and local fields: dirty/untracked,
	# merged-into-base (offline hint), ahead/behind of upstream. Field order
	# keeps repo=2, branch=3 so the repo-then-branch sort below is unchanged.
	# --pr adds the real (squash/rebase-aware) merge signal; fields are read
	# defensively so a caller/stub without --pr still parses. Markers are
	# information, not guards - removal deletes only branches already merged
	# into base (git branch -d), so removing a clean tree loses nothing.
	rows=$(wt-status --all --pr --json |
		jq -r '.[] | [.path,
			((.path | split("/.trees/")[1] // "") | split("/")[0]),
			.branch,
			(.pr_state // "unknown"),
			((.pr_number // "") | tostring),
			(if .dirty or .untracked then "1" else "0" end),
			(if .merged_into_base then "1" else "0" end),
			(.ahead // 0 | tostring),
			(.behind // 0 | tostring)] | @tsv' |
		sort -t'	' -k2,2 -k3,3)
	[ -n "$rows" ] || soft_fail 'No managed worktrees - prefix + Alt+w creates one'
	panes=$(tmux list-panes -a -F '#{window_id}	#{pane_current_path}')
	# Render display columns. The PR-state verdict is a fixed-width column
	# placed after repo, before branch: it folds reap-eligibility into the
	# token (MERGED + clean + not-ahead = ✓ reap, safe to ctrl-x) so the
	# actionable answer survives a long branch truncating the tail. Plain text
	# is padded to a set width first, then wrapped in ANSI, so the padding
	# maths ignores escape bytes. Local flags trail (may truncate harmlessly);
	# ◉ live marks a pane at or inside the worktree (path-boundary match).
	display=$(printf '%s\n' "$rows" | PANES="$panes" awk '
		BEGIN {
			FS = "\t"
			E = "\033["; R = "\033[0m"; W = 8
			np = split(ENVIRON["PANES"], pl, "\n")
			for (i = 1; i <= np; i++) {
				split(pl[i], pf, "\t")
				if (pf[2] != "") pc[++pn] = pf[2]
			}
		}
		$1 == "" { next }
		{
			path = $1; repo = $2; branch = $3; st = $4
			dirty = ($6 == "1"); merged = ($7 == "1")
			ahead = $8 + 0; behind = $9 + 0

			# PR-state verdict: glyph + word + colour + plain display width.
			if (st == "MERGED") {
				if (!dirty && ahead == 0) { g = "✓"; w = "reap"; c = "92"; dw = 6 }
				else { g = "✓"; w = "merged"; c = "2;32"; dw = 8 }
			} else if (st == "OPEN") { g = "○"; w = "open"; c = "36"; dw = 6 }
			else if (st == "CLOSED") { g = "✗"; w = "closed"; c = "31"; dw = 8 }
			else if (st == "none") { g = "·"; w = "-"; c = "2"; dw = 3 }
			else if (merged) { g = "?"; w = "merged"; c = "2"; dw = 8 }
			else { g = "?"; w = "…"; c = "2"; dw = 3 }
			pad = ""
			for (i = dw; i < W; i++) pad = pad " "
			tok = E c "m" g " " w R pad

			# Trailing local flags (glyph + colour); truncatable detail.
			m = ""; sep = ""
			for (i = 1; i <= pn; i++)
				if (pc[i] == path || index(pc[i], path "/") == 1) {
					m = E "34m◉ live" R; sep = " "; break
				}
			if (dirty) { m = m sep E "31m● dirty" R; sep = " " }
			if (ahead > 0) { m = m sep E "33m↑" ahead R; sep = " " }
			if (behind > 0) { m = m sep E "35m↓" behind R; sep = " " }

			nr++
			paths[nr] = path; repos[nr] = repo; prtok[nr] = tok
			branches[nr] = branch; flags[nr] = m
			if (length(repo) > rw) rw = length(repo)
			if (length(branch) > bw) bw = length(branch)
		}
		END {
			fmt = "%s\t%-" rw "s  %s  %-" bw "s  %s\n"
			for (i = 1; i <= nr; i++)
				printf fmt, paths[i], repos[i], prtok[i], branches[i], flags[i]
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
