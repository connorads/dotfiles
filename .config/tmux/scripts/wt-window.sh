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
#   pick          fzf over managed worktrees: columns are repo, a fixed-width
#                 PR-state verdict (✓ reap / ✓ merged / ○ open / ✗ closed /
#                 · - / ? … / ⋯ … loading), branch, then a truncatable
#                 local-flags column (◉ live / ● dirty / ↑ahead / ↓behind).
#                 State is glyph + colour, so it reads without colour and the
#                 verdict survives truncation (fixed column, ahead of branch).
#                 Opens instantly via a two-phase load: the fast local render
#                 (repo + branch, no git status, ~0.1s) paints first with a
#                 ⋯ … loading PR token, then an fzf load-triggered reload swaps
#                 in the full wt-status --all --pr render (PR verdict + local
#                 flags, ~3s) once ready. Offline (no gh) degrades to ? with the
#                 local merged hint. git log + status preview; enter → open,
#                 ctrl-v → pane here, ctrl-x → remove (wt-remove
#                 --delete-branch: merged branch deleted, unmerged kept)
#   pick-render <fast|full>
#                 internal: emit the fzf display TSV (hidden path field 1, then
#                 repo, PR verdict, branch, trailing local flags). fast = local
#                 enumerate only; full = wt-status --all --pr enrichment. Kept a
#                 subcommand so fzf's reload can re-invoke it as a fresh process.
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

# wt-add / wt-status are dual-mode zsh functions exposed via ~/.local/bin;
# the tmux server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

self="${BASH_SOURCE[0]}"

# _wt-common (zsh lib) owns _wt_managed_worktrees, the vetted ~/.trees walk that
# skips phantom submodule/node_modules .git markers. The fast render reuses it
# rather than reimplementing the walk here (single source of truth). Overridable
# so tests can point at the repo copy under a throwaway HOME.
: "${WT_COMMON:=$HOME/.config/zsh/functions/git/_wt-common}"

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
pick-render)
	# Emit the fzf display TSV. Two modes feed one shared awk renderer so the
	# fast and full passes are byte-compatible (same columns, sort, field-1
	# path), letting fzf swap one for the other via reload without re-laying-out.
	#   full  wt-status --all --pr --json -> full PR verdict + local flags (~3s)
	#   fast  local enumerate only (repo + branch, no git status) -> ⋯ loading PR
	#         token, ~0.1s, so the picker opens instantly
	# Row shape (9 TSV fields): path (hidden), repo (path component after
	# ~/.trees), branch, pr_state, pr_number, dirty/untracked, merged-into-base
	# (offline hint), ahead, behind. Field order keeps repo=2, branch=3 so the
	# repo-then-branch sort is stable across modes.
	mode="${2:-full}"
	if [ "$mode" = fast ]; then
		# One cheap `git branch` per worktree; no git status/upstream/gh. PR
		# state = loading, local counters 0, so only the ◉ live flag can show.
		rows=$(
			zsh -fc 'source "$1"; _wt_managed_worktrees' zsh "$WT_COMMON" |
				while IFS= read -r wt; do
					[ -n "$wt" ] || continue
					after=${wt##*/.trees/}
					repo=${after%%/*}
					br=$(git -C "$wt" branch --show-current 2>/dev/null) || br=""
					printf '%s\t%s\t%s\tloading\t\t0\t0\t0\t0\n' "$wt" "$repo" "$br"
				done |
				sort -t'	' -k2,2 -k3,3
		)
	else
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
	fi
	[ -n "$rows" ] || exit 0
	# A fresh process (fzf's reload) computes its own pane set rather than
	# inheriting a stale env snapshot.
	panes=$(tmux list-panes -a -F '#{window_id}	#{pane_current_path}')
	# Render display columns. The PR-state verdict is a fixed-width column
	# placed after repo, before branch: it folds reap-eligibility into the
	# token (MERGED + clean + not-ahead = ✓ reap, safe to ctrl-x) so the
	# actionable answer survives a long branch truncating the tail. Plain text
	# is padded to a set width first, then wrapped in ANSI, so the padding
	# maths ignores escape bytes. Local flags trail (may truncate harmlessly);
	# ◉ live marks a pane at or inside the worktree (path-boundary match).
	printf '%s\n' "$rows" | PANES="$panes" awk '
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
			else if (st == "loading") { g = "⋯"; w = "…"; c = "2"; dw = 3 }
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
		}'
	;;
pick)
	# Async two-phase render: pipe the fast local paint into fzf so it opens in
	# ~0.1s, then fzf's first `load` (fast stdin drained) fires a guarded
	# `transform` that reloads the full --pr render. A one-shot sentinel breaks
	# fzf's load->reload->load loop: the full pass's own load sees the sentinel
	# and emits nothing. The list is usable (open/pane/remove) throughout.
	sentinel=$(mktemp -u "${TMPDIR:-/tmp}/wtpick.XXXXXX")
	out=$("$self" pick-render fast |
		fzf --reverse --ansi \
			--header='enter: window · ctrl-v: pane here · ctrl-x: remove' \
			--delimiter='\t' --with-nth=2.. --expect=ctrl-v,ctrl-x \
			--bind "load:transform:[ -e $sentinel ] && exit 0; : > $sentinel; printf 'reload(%s pick-render full)' \"$self\"" \
			--preview 'git -C {1} log --oneline --decorate -10; echo; git -C {1} status --short') || {
		rm -f "$sentinel"
		exit 0
	}
	rm -f "$sentinel"
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
	echo "usage: wt-window.sh open <path> | pane <path> | new <branch> | pick | pick-render <fast|full>" >&2
	exit 1
	;;
esac
