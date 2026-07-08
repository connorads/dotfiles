#!/usr/bin/env bash
# codex-branch-menu.sh: fork the focused pane's live Codex session into a new
# pane/window (prefix + Alt+b via agent-branch-menu.sh). Resolves pane -> codex
# PID -> active ~/.codex/sessions/.../rollout-*.jsonl, then offers a
# display-menu palette that runs `codex ... fork <sid>`.
#
# Usage: codex-branch-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
#        codex-branch-menu.sh fork-worktree <branch> <session-id>
set -euo pipefail

shell_quote() {
	printf '%q' "$1"
}

codex_fork_cmd() {
	local cwd="$1"
	local sid="$2"

	printf 'codex --dangerously-bypass-approvals-and-sandbox -C %s fork %s' \
		"$(shell_quote "$cwd")" "$(shell_quote "$sid")"
}

# fork-worktree mode: runs inside a display-popup whose cwd is the repo (set by
# the "Fork → new WORKTREE window" menu item below). Creates/reuses the
# worktree via wt-add, then opens a window there running the forked session.
if [ "${1:-}" = "fork-worktree" ]; then
	PATH="$HOME/.local/bin:$PATH"
	soft_fail() {
		printf '%s\n' "$1" >&2
		printf 'Press any key…' >&2
		read -rsn1 || true
		exit 0
	}
	[ "$#" -eq 3 ] || soft_fail "usage: fork-worktree <branch> <session-id> (branch must not contain spaces)"
	branch="$2"
	sid="$3"
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	fork_cmd=$(codex_fork_cmd "$path" "$sid")
	tmux new-window -c "$path" "$fork_cmd"
	exit 0
fi

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_path="${3:-}"
pane_pid="${4:-}"

no_session() {
	tmux display-message "No Codex in this pane"
	exit 0
}

not_forkable() {
	local reason="${2:-not registered}"
	tmux display-message "Codex here (pid $1) but $reason - not forkable"
	exit 0
}

command -v jq >/dev/null 2>&1 || {
	tmux display-message "jq not found - cannot branch Codex session"
	exit 0
}

command -v lsof >/dev/null 2>&1 || {
	tmux display-message "lsof not found - cannot branch Codex session"
	exit 0
}

codex_pid=$(agent_foreground_pid_for_tty "$pane_tty" "codex" "$pane_pid")
[ -n "$codex_pid" ] || no_session

resolved=$(codex_session_resolve_for_pid "$codex_pid" "$pane_path" 2>/dev/null || true)
[ -n "$resolved" ] || not_forkable "$codex_pid" "no active rollout"

sid=$(printf '%s' "$resolved" | jq -r '.sessionId // empty' 2>/dev/null || true)
[ -n "$sid" ] || not_forkable "$codex_pid" "no session id"

cwd=$(printf '%s' "$resolved" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$pane_path"

label="${cwd##*/}"
[ -n "$label" ] || label="session"

title=" Branch Codex · $label "
fork_cmd=$(codex_fork_cmd "$cwd" "$sid")

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
