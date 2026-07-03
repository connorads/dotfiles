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

no_session() {
	tmux display-message "No Claude session in this pane"
	exit 0
}

command -v jq >/dev/null 2>&1 || no_session

claude_pid=$(claude_foreground_pid_for_tty "$pane_tty" "claude" "$pane_pid")
[ -n "$claude_pid" ] || no_session

meta=$(claude_session_meta_for_pid "$claude_pid")
[ -n "$meta" ] || no_session

sid=$(printf '%s' "$meta" | jq -r '.sessionId // empty' 2>/dev/null || true)
[ -n "$sid" ] || no_session

name=$(printf '%s' "$meta" | jq -r '.name // empty' 2>/dev/null || true)
status=$(printf '%s' "$meta" | jq -r '.status // empty' 2>/dev/null || true)
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
