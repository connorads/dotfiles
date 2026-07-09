#!/usr/bin/env bash
# claude-branch-menu.sh: fork the focused pane's live Claude session into a new
# pane/window (prefix + Alt+b). Resolves pane -> claude PID -> the live
# ~/.claude/sessions/<pid>.json golden source, then offers a display-menu palette
# that runs `claude --dangerously-skip-permissions -r <sid> --fork-session` in a
# split/window (spatial branch: bypass-permissions mode matches the `cy` alias;
# the original pane is left untouched).
#
# Usage: claude-branch-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
#        claude-branch-menu.sh prompt-repeat <split-right|split-down|new-window> <pane-id> <cwd> <session-id>
#        claude-branch-menu.sh prompt-worktree <cwd> <session-id>
#        claude-branch-menu.sh prompt-worktrees <cwd> <session-id>
#        claude-branch-menu.sh fork-repeat <split-right|split-down|new-window> <count> <pane-id> <cwd> <session-id>
#        claude-branch-menu.sh fork-worktree <branch> <session-id>
#        claude-branch-menu.sh fork-worktrees <count> <branch-prefix> <session-id>
set -euo pipefail

shell_quote() {
	printf '%q' "$1"
}

tmux_quote() {
	local value=$1
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	printf '"%s"' "$value"
}

soft_fail() {
	printf '%s\n' "$1" >&2
	printf 'Press any key…' >&2
	read -rsn1 || true
	exit 0
}

normalise_fork_count() {
	local count=${1:-}
	[[ "$count" =~ ^[0-9]+$ ]] || return 1
	count=$((10#$count))
	[ "$count" -ge 1 ] && [ "$count" -le 8 ] || return 1
	printf '%s\n' "$count"
}

claude_fork_cmd() {
	local sid=$1

	printf 'claude --dangerously-skip-permissions -r %s --fork-session' "$(shell_quote "$sid")"
}

fork_worktree_window() {
	local branch=$1
	local sid=$2
	local path

	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	tmux new-window -c "$path" "$(claude_fork_cmd "$sid")"
}

# Script modes are used by menu commands after the live session has already
# been resolved, so keep them before the jq/session discovery path.
case "${1:-}" in
prompt-repeat)
	[ "$#" -eq 5 ] || soft_fail "usage: prompt-repeat <split-right|split-down|new-window> <pane-id> <cwd> <session-id>"
	action=$2
	case "$action" in
	split-right | split-down | new-window) ;;
	*) soft_fail "Unknown fork action: $action" ;;
	esac
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	pane_arg=$(shell_quote "$3")
	cwd_arg=$(shell_quote "$4")
	sid_arg=$(shell_quote "$5")
	repeat_cmd="$self_arg fork-repeat $action %% $pane_arg $cwd_arg $sid_arg"
	tmux command-prompt -I "4" -p "Fork count:" "run-shell $(tmux_quote "$repeat_cmd")"
	exit 0
	;;
prompt-worktree)
	[ "$#" -eq 3 ] || soft_fail "usage: prompt-worktree <cwd> <session-id>"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd=$2
	sid_arg=$(shell_quote "$3")
	worktree_cmd="$self_arg fork-worktree %% $sid_arg"
	tmux command-prompt -p "Worktree branch:" "display-popup -E -w 80% -h 60% -d $(tmux_quote "$cwd") $(tmux_quote "$worktree_cmd")"
	exit 0
	;;
prompt-worktrees)
	[ "$#" -eq 3 ] || soft_fail "usage: prompt-worktrees <cwd> <session-id>"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd=$2
	sid_arg=$(shell_quote "$3")
	worktrees_cmd="$self_arg fork-worktrees %% %2 $sid_arg"
	tmux command-prompt -I "4," -p "Fork count:,Worktree branch prefix:" "display-popup -E -w 80% -h 60% -d $(tmux_quote "$cwd") $(tmux_quote "$worktrees_cmd")"
	exit 0
	;;
fork-repeat)
	[ "$#" -eq 6 ] || soft_fail "usage: fork-repeat <split-right|split-down|new-window> <count> <pane-id> <cwd> <session-id>"
	action=$2
	count=$(normalise_fork_count "$3") ||
		soft_fail "Fork count must be between 1 and 8: ${3:-<empty>}"
	pane_id=$4
	cwd=$5
	sid=$6
	fork_cmd=$(claude_fork_cmd "$sid")
	case "$action" in
	split-right)
		for ((i = 1; i <= count; i++)); do
			tmux split-window -h -t "$pane_id" -c "$cwd" "$fork_cmd"
		done
		tmux select-layout -t "$pane_id" even-horizontal
		;;
	split-down)
		for ((i = 1; i <= count; i++)); do
			tmux split-window -v -t "$pane_id" -c "$cwd" "$fork_cmd"
		done
		tmux select-layout -t "$pane_id" even-vertical
		;;
	new-window)
		for ((i = 1; i <= count; i++)); do
			tmux new-window -c "$cwd" "$fork_cmd"
		done
		;;
	*) soft_fail "Unknown fork action: $action" ;;
	esac
	exit 0
	;;
fork-worktree)
	# wt-add is a dual-mode zsh function exposed via ~/.local/bin; the tmux
	# server's PATH may not carry that dir.
	PATH="$HOME/.local/bin:$PATH"
	# A branch typed with spaces splits the command-prompt %% substitution into
	# extra argv words - surface that instead of forking into a wrong branch.
	[ "$#" -eq 3 ] || soft_fail "usage: fork-worktree <branch> <session-id> (branch must not contain spaces)"
	branch=$2
	sid=$3
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	fork_worktree_window "$branch" "$sid"
	exit 0
	;;
fork-worktrees)
	PATH="$HOME/.local/bin:$PATH"
	[ "$#" -eq 4 ] || soft_fail "usage: fork-worktrees <count> <branch-prefix> <session-id> (prefix must not contain spaces)"
	count=$(normalise_fork_count "$2") ||
		soft_fail "Fork count must be between 1 and 8: ${2:-<empty>}"
	prefix=$3
	sid=$4
	[ -n "$prefix" ] || soft_fail "Worktree branch prefix is required"
	case "$prefix" in
	*[[:space:]]*) soft_fail "Branch prefix must not contain spaces: $prefix" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	for ((i = 1; i <= count; i++)); do
		fork_worktree_window "$prefix-$i" "$sid"
	done
	exit 0
	;;
esac

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

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

claude_pid=$(agent_foreground_pid_for_tty "$pane_tty" "claude" "$pane_pid")
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
fork_cmd=$(claude_fork_cmd "$sid")

# Fork into a brand-new worktree window: prompt for a branch, then run this
# script's fork-worktree mode in a popup rooted at the session's repo so wt-add
# resolves it and its setup output stays visible. %% is the typed branch.
self="${BASH_SOURCE[0]}"
self_arg=$(shell_quote "$self")
pane_target=$(tmux display-message -p -t "$pane_id" '#{session_id}:#{window_id}.#{pane_index}' 2>/dev/null || true)
[ -n "$pane_target" ] || pane_target="$pane_id"
pane_arg=$(shell_quote "$pane_target")
cwd_arg=$(shell_quote "$cwd")
sid_arg=$(shell_quote "$sid")

prompt_right_cmd="$self_arg prompt-repeat split-right $pane_arg $cwd_arg $sid_arg"
prompt_down_cmd="$self_arg prompt-repeat split-down $pane_arg $cwd_arg $sid_arg"
prompt_window_cmd="$self_arg prompt-repeat new-window $pane_arg $cwd_arg $sid_arg"
prompt_worktree_cmd="$self_arg prompt-worktree $cwd_arg $sid_arg"
prompt_worktrees_cmd="$self_arg prompt-worktrees $cwd_arg $sid_arg"

fork_split_right_n="run-shell $(tmux_quote "$prompt_right_cmd")"
fork_split_down_n="run-shell $(tmux_quote "$prompt_down_cmd")"
fork_window_n="run-shell $(tmux_quote "$prompt_window_cmd")"
fork_wt="run-shell $(tmux_quote "$prompt_worktree_cmd")"
fork_wts_n="run-shell $(tmux_quote "$prompt_worktrees_cmd")"

tmux display-menu -T "$title" -x C -y C \
	"Split right" "|" "split-window -h -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"Split right x N" "R" "$fork_split_right_n" \
	"Split down" "-" "split-window -v -t $pane_id -c \"$cwd\" \"$fork_cmd\"" \
	"Split down x N" "D" "$fork_split_down_n" \
	"New window" "w" "new-window -c \"$cwd\" \"$fork_cmd\"" \
	"New windows x N" "N" "$fork_window_n" \
	"" \
	"Fork → new WORKTREE window" "W" "$fork_wt" \
	"WORKTREE windows x N" "T" "$fork_wts_n" \
	"" \
	"Copy fork command" "c" "set-buffer -w -- \"$fork_cmd\" ; display-message \"Copied fork command\"" \
	"Copy session id" "y" "set-buffer -w -- \"$sid\" ; display-message \"Copied session id\""
