#!/usr/bin/env bash
# claude-branch-menu.sh: fork the focused pane's live Claude session into a new
# pane/window (prefix + Alt+b). Resolves pane -> claude PID -> the live
# ~/.claude/sessions/<pid>.json golden source, then offers a display-menu palette
# that runs `claude --dangerously-skip-permissions -r <sid> --fork-session` in a
# split/window (spatial branch: bypass-permissions mode matches the `cy` alias;
# the original pane is left untouched).
#
# Usage: claude-branch-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
set -euo pipefail

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

tmux display-menu -T "$title" -x C -y C \
	"Split right" "|" "split-window -h -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"Split down" "-" "split-window -v -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"New window" "w" "new-window -c \"$cwd\" \"$fork_cmd\"" \
	"" \
	"Copy fork command" "c" "set-buffer -w -- \"$fork_cmd\" ; display-message \"Copied fork command\"" \
	"Copy session id" "y" "set-buffer -w -- \"$sid\" ; display-message \"Copied session id\""
