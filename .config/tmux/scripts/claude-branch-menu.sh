#!/usr/bin/env bash
# claude-branch-menu.sh: fork the focused pane's live Claude session into a new
# pane/window (prefix + Alt+b). Resolves pane -> claude PID -> the live
# ~/.claude/sessions/<pid>.json golden source, then offers a display-menu palette
# that runs `claude --dangerously-skip-permissions -r <sid> --fork-session` in a
# split/window (spatial branch: bypass-permissions mode matches the `cy` alias;
# the original pane is left untouched).
#
# Usage: claude-branch-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
#        claude-branch-menu.sh fork-worktree <branch> <session-id>
set -euo pipefail

# fork-worktree mode: runs inside a display-popup whose cwd is the repo (set by
# the "Fork → new WORKTREE window" menu item below). Creates/reuses the
# worktree via wt-add (setup output visible in the popup), then opens a window
# there running the forked session. Backward compatible: pane-id first args
# (%N) never equal fork-worktree.
if [ "${1:-}" = "fork-worktree" ]; then
	# wt-add is a dual-mode zsh function exposed via ~/.local/bin; the tmux
	# server's PATH may not carry that dir.
	PATH="$HOME/.local/bin:$PATH"
	soft_fail() {
		printf '%s\n' "$1" >&2
		printf 'Press any key…' >&2
		read -rsn1 || true
		exit 0
	}
	# A branch typed with spaces splits the command-prompt %% substitution into
	# extra argv words — surface that instead of forking into a wrong branch.
	[ "$#" -eq 3 ] || soft_fail "usage: fork-worktree <branch> <session-id> (branch must not contain spaces)"
	branch="$2"
	sid="$3"
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	tmux new-window -c "$path" "claude --dangerously-skip-permissions -r $sid --fork-session"
	exit 0
fi

# shellcheck source=lib/claude-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/claude-session.sh"

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_path="${3:-}"
pane_pid="${4:-}"

# No live Claude foreground process in this pane - nothing to branch.
no_session() {
	tmux display-message "No Claude in this pane"
	exit 0
}

# Claude is running here but wrote no ~/.claude/sessions/<pid>.json registry entry,
# so there is no sessionId to fork. Expected for agent/child sessions and for
# sessions that skipped registration at launch (see the concurrentSessions guard);
# a running session never registers retroactively.
not_forkable() {
	local reason="${2:-not registered}"
	tmux display-message "Claude here (pid $1) but $reason - not forkable"
	exit 0
}

command -v jq >/dev/null 2>&1 || {
	tmux display-message "jq not found - cannot branch Claude session"
	exit 0
}

claude_pid=$(claude_foreground_pid_for_tty "$pane_tty" "claude" "$pane_pid")
[ -n "$claude_pid" ] || no_session

meta=$(claude_session_meta_for_pid "$claude_pid")
if [ -z "$meta" ]; then
	resolved=$(claude_session_resolve_for_pid "$claude_pid" "$pane_id" "$pane_path" 2>/dev/null || true)
	if [ -z "$resolved" ]; then
		not_forkable "$claude_pid" "not registered"
	fi
	resolved_status=$(printf '%s' "$resolved" | jq -r '.status // empty' 2>/dev/null || true)
	if [ "$resolved_status" != "resolved" ]; then
		reason=$(printf '%s' "$resolved" | jq -r '.reason // "not registered"' 2>/dev/null || true)
		not_forkable "$claude_pid" "$reason"
	fi
	meta="$resolved"
fi

sid=$(printf '%s' "$meta" | jq -r '.sessionId // empty' 2>/dev/null || true)
[ -n "$sid" ] || not_forkable "$claude_pid"

name=$(printf '%s' "$meta" | jq -r '.name // empty' 2>/dev/null || true)
status=$(printf '%s' "$meta" | jq -r '.claudeStatus // empty' 2>/dev/null || true)
cwd=$(printf '%s' "$meta" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$pane_path"

[ -n "$name" ] || name="session"
[ -n "$status" ] || status="idle"

title=" Branch · $name [$status] "
# Fork in bypass-permissions mode (matches the `cy` alias) so the branched pane
# is immediately usable without re-approving the fork.
fork_cmd="claude --dangerously-skip-permissions -r $sid --fork-session"

# Fork into a brand-new worktree window: prompt for a branch, then run this
# script's fork-worktree mode in a popup rooted at the session's repo so wt-add
# resolves it and its setup output stays visible. cwd/self/sid are expanded by
# bash here, at menu-build time; %% is the typed branch.
self="${BASH_SOURCE[0]}"
fork_wt="command-prompt -p \"Worktree branch:\" \"display-popup -E -w 80% -h 60% -d '$cwd' '$self fork-worktree %% $sid'\""

tmux display-menu -T "$title" -x C -y C \
	"Split right" "|" "split-window -h -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"Split down" "-" "split-window -v -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"New window" "w" "new-window -c \"$cwd\" \"$fork_cmd\"" \
	"" \
	"Fork → new WORKTREE window" "W" "$fork_wt" \
	"" \
	"Copy fork command" "c" "set-buffer -w -- \"$fork_cmd\" ; display-message \"Copied fork command\"" \
	"Copy session id" "y" "set-buffer -w -- \"$sid\" ; display-message \"Copied session id\""
