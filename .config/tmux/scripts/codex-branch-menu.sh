#!/usr/bin/env bash
# codex-branch-menu.sh: fork the focused pane's live Codex session into a new
# pane/window (prefix + Alt+b via agent-branch-menu.sh). Resolves pane -> codex
# PID -> active ~/.codex/sessions/.../rollout-*.jsonl, then offers a
# display-menu palette that runs `codex <source-flags> ... fork <sid>`.
#
# The fork mirrors the source pane's live launch flags via
# resurrect_argv_codex_flags, like the restore path: a fork never has more
# authority than the pane it came from, so a plain `cx` source stays sandboxed
# and only a `cxy` source carries --dangerously-bypass-approvals-and-sandbox.
#
# Usage: codex-branch-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
#        codex-branch-menu.sh prompt-repeat <split-right|split-down|new-window> <pane-id> <cwd> <session-id> [flags]
#        codex-branch-menu.sh prompt-worktree <cwd> <session-id> [flags]
#        codex-branch-menu.sh prompt-worktrees <cwd> <session-id> [flags]
#        codex-branch-menu.sh fork-repeat <split-right|split-down|new-window> <count> <pane-id> <cwd> <session-id> [flags]
#        codex-branch-menu.sh fork-worktree <branch> <session-id> [flags]
#        codex-branch-menu.sh fork-worktrees <count> <branch-prefix> <session-id> [flags]
#        codex-branch-menu.sh handoff-menu <session-id> <cwd> <pane-target> [flags]
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

shell_quote() {
	printf '%q' "$1"
}

tmux_quote() {
	local value=$1
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	printf '"%s"' "$value"
}

# float_cmd <cwd> <shell-command>
# The shell string run-shell executes to open <shell-command> in a big floating
# pane rooted at <cwd>. A float, not a popup: wt-add runs the repo's setup (rs),
# which is slow, and a modal popup would hold the client for the whole run.
# flt is the single door to a float, carrying the tmux#5327 unzoom guard.
float_cmd() {
	printf '%s -c %s big %s' \
		"$(shell_quote "$HOME/.local/bin/flt")" "$(shell_quote "$1")" "$(shell_quote "$2")"
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

codex_fork_cmd() {
	local cwd="$1"
	local sid="$2"
	local flags="${3:-}"

	# flags mirrors the source pane's launch flags (approval/sandbox mode, model,
	# -c overrides) from resurrect_argv_codex_flags. Inserted unquoted so it
	# word-splits back into separate flags. Empty flags -> bare fork: a plain `cx`
	# source must NOT be escalated to bypass by the act of forking it.
	printf 'codex%s -C %s fork %s' \
		"${flags:+ $flags}" "$(shell_quote "$cwd")" "$(shell_quote "$sid")"
}

# codex_flags_are_bypass <flags>
# True when the mirrored source flags carry Codex's full-bypass mode. The one bit
# of the source pane's authority that means anything in the other CLI.
codex_flags_are_bypass() {
	case " ${1:-} " in
	*" --dangerously-bypass-approvals-and-sandbox "*) return 0 ;;
	esac
	return 1
}

# codex_handoff_cmd <sid> [flags]
# Hand the pane's live Codex session off to Claude: translate its transcript into
# Claude's store and resume it there (handoff self-opens the target in
# foreground, so no --no-open). No account prefix - Codex is a single store and
# the target lands in the default ~/.claude account. Uses the absolute
# ~/.local/bin wrapper path because the tmux server's PATH may not carry that dir.
#
# A bypass source pane hands off as a bypass Claude pane: handoff appends
# HANDOFF_CLAUDE_OPEN_ARGS verbatim to its `claude -r <sid>` launch, so the menu
# keeps deciding authority and handoff only carries it. Only the posture boolean
# crosses agents - --model / -c key=val are meaningless in the other CLI. The
# inline VAR=val prefix is the same idiom claude_handoff_cmd uses for
# CLAUDE_CONFIG_DIR, and is POSIX-sh safe under tmux's `sh -c`.
codex_handoff_cmd() {
	local sid="$1"
	local flags="${2:-}"

	local prefix=""
	if codex_flags_are_bypass "$flags"; then
		prefix="HANDOFF_CLAUDE_OPEN_ARGS='--dangerously-skip-permissions' "
	fi

	printf '%s%s --from codex --to claude %s' \
		"$prefix" "$(shell_quote "$HOME/.local/bin/handoff")" "$(shell_quote "$sid")"
}

fork_worktree_window() {
	local branch="$1"
	local sid="$2"
	local flags="${3:-}"
	local path
	local fork_cmd

	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	fork_cmd=$(codex_fork_cmd "$path" "$sid" "$flags")
	tmux new-window -c "$path" "$fork_cmd"
}

# Script modes are used by menu commands after the live session has already
# been resolved, so keep them before the jq/session discovery path.
case "${1:-}" in
prompt-repeat)
	{ [ "$#" -ge 5 ] && [ "$#" -le 6 ]; } || soft_fail "usage: prompt-repeat <split-right|split-down|new-window> <pane-id> <cwd> <session-id> [flags]"
	action="$2"
	case "$action" in
	split-right | split-down | new-window) ;;
	*) soft_fail "Unknown fork action: $action" ;;
	esac
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	pane_arg=$(shell_quote "$3")
	cwd_arg=$(shell_quote "$4")
	sid_arg=$(shell_quote "$5")
	flags_arg=$(shell_quote "${6:-}")
	repeat_cmd="$self_arg fork-repeat $action %% $pane_arg $cwd_arg $sid_arg $flags_arg"
	tmux command-prompt -I "4" -p "Fork count:" "run-shell $(tmux_quote "$repeat_cmd")"
	exit 0
	;;
prompt-worktree)
	{ [ "$#" -ge 3 ] && [ "$#" -le 4 ]; } || soft_fail "usage: prompt-worktree <cwd> <session-id> [flags]"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd="$2"
	sid_arg=$(shell_quote "$3")
	flags_arg=$(shell_quote "${4:-}")
	worktree_cmd="$self_arg fork-worktree %% $sid_arg $flags_arg"
	tmux command-prompt -p "Worktree branch:" \
		"run-shell $(tmux_quote "$(float_cmd "$cwd" "$worktree_cmd")")"
	exit 0
	;;
prompt-worktrees)
	{ [ "$#" -ge 3 ] && [ "$#" -le 4 ]; } || soft_fail "usage: prompt-worktrees <cwd> <session-id> [flags]"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd="$2"
	sid_arg=$(shell_quote "$3")
	flags_arg=$(shell_quote "${4:-}")
	worktrees_cmd="$self_arg fork-worktrees %% %2 $sid_arg $flags_arg"
	tmux command-prompt -I "4," -p "Fork count:,Worktree branch prefix:" \
		"run-shell $(tmux_quote "$(float_cmd "$cwd" "$worktrees_cmd")")"
	exit 0
	;;
fork-repeat)
	{ [ "$#" -ge 6 ] && [ "$#" -le 7 ]; } || soft_fail "usage: fork-repeat <split-right|split-down|new-window> <count> <pane-id> <cwd> <session-id> [flags]"
	action="$2"
	count=$(normalise_fork_count "$3") ||
		soft_fail "Fork count must be between 1 and 8: ${3:-<empty>}"
	pane_id="$4"
	cwd="$5"
	sid="$6"
	flags="${7:-}"
	fork_cmd=$(codex_fork_cmd "$cwd" "$sid" "$flags")
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
	PATH="$HOME/.local/bin:$PATH"
	{ [ "$#" -ge 3 ] && [ "$#" -le 4 ]; } || soft_fail "usage: fork-worktree <branch> <session-id> [flags] (branch must not contain spaces)"
	branch="$2"
	sid="$3"
	flags="${4:-}"
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	fork_worktree_window "$branch" "$sid" "$flags"
	exit 0
	;;
fork-worktrees)
	PATH="$HOME/.local/bin:$PATH"
	{ [ "$#" -ge 4 ] && [ "$#" -le 5 ]; } || soft_fail "usage: fork-worktrees <count> <branch-prefix> <session-id> [flags] (prefix must not contain spaces)"
	count=$(normalise_fork_count "$2") ||
		soft_fail "Fork count must be between 1 and 8: ${2:-<empty>}"
	prefix="$3"
	sid="$4"
	flags="${5:-}"
	[ -n "$prefix" ] || soft_fail "Worktree branch prefix is required"
	case "$prefix" in
	*[[:space:]]*) soft_fail "Branch prefix must not contain spaces: $prefix" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	for ((i = 1; i <= count; i++)); do
		fork_worktree_window "$prefix-$i" "$sid" "$flags"
	done
	exit 0
	;;
handoff-menu)
	# The Handoff → Claude placement submenu (split right/down / new window),
	# reached via run-shell from the branch menu's "Handoff → Claude" row. Splits
	# against the stable pane_target (session:window.pane), not "%N".
	{ [ "$#" -ge 4 ] && [ "$#" -le 5 ]; } || soft_fail "usage: handoff-menu <sid> <cwd> <pane-target> [flags]"
	sid="$2"
	cwd="$3"
	pane_target="$4"
	flags="${5:-}"

	handoff_cmd=$(codex_handoff_cmd "$sid" "$flags")
	tmux display-menu -T " Handoff → Claude " -x C -y C \
		"Split right" "|" "split-window -h -t $pane_target -c \"$cwd\" \"$handoff_cmd\"" \
		"Split down" "-" "split-window -v -t $pane_target -c \"$cwd\" \"$handoff_cmd\"" \
		"New window" "w" "new-window -c \"$cwd\" \"$handoff_cmd\""
	exit 0
	;;
esac

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

# resurrect_argv_codex_flags preserves the source pane's launch flags so the fork
# mirrors it (the same lib the restore path uses). Guarded on existence like the
# resurrect strategy does; missing -> empty flags -> bare fork.
# shellcheck source=lib/resurrect-argv.sh disable=SC1091
[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/resurrect-argv.sh" ] &&
	. "$(dirname "${BASH_SOURCE[0]}")/lib/resurrect-argv.sh"

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
# Mirror the source pane's launch flags (approval/sandbox mode, model, -c
# overrides) into the fork, like the resurrect restore path - a fork of a plain
# `cx` pane stays sandboxed, a `cxy` pane keeps its bypass.
# resurrect_argv_codex_flags keeps them verbatim, strips the source's own stale
# resume/--last state (clean fork-of-fork), and returns non-zero on argv0
# mismatch (wrapper) - empty fork_flags then yields a bare fork.
fork_flags=""
if command -v resurrect_argv_codex_flags >/dev/null 2>&1; then
	fork_flags=$(resurrect_argv_codex_flags "$(ps -o args= -p "$codex_pid")" 2>/dev/null || true)
fi

fork_cmd=$(codex_fork_cmd "$cwd" "$sid" "$fork_flags")

self="${BASH_SOURCE[0]}"
self_arg=$(shell_quote "$self")
pane_target=$(tmux display-message -p -t "$pane_id" '#{session_id}:#{window_id}.#{pane_index}' 2>/dev/null || true)
[ -n "$pane_target" ] || pane_target="$pane_id"
pane_arg=$(shell_quote "$pane_target")
cwd_arg=$(shell_quote "$cwd")
sid_arg=$(shell_quote "$sid")
# The mirrored flags carry spaces; shell_quote threads them as one positional
# that expands unquoted back into separate flags in codex_fork_cmd.
flags_arg=$(shell_quote "$fork_flags")

prompt_right_cmd="$self_arg prompt-repeat split-right $pane_arg $cwd_arg $sid_arg $flags_arg"
prompt_down_cmd="$self_arg prompt-repeat split-down $pane_arg $cwd_arg $sid_arg $flags_arg"
prompt_window_cmd="$self_arg prompt-repeat new-window $pane_arg $cwd_arg $sid_arg $flags_arg"
prompt_worktree_cmd="$self_arg prompt-worktree $cwd_arg $sid_arg $flags_arg"
prompt_worktrees_cmd="$self_arg prompt-worktrees $cwd_arg $sid_arg $flags_arg"
handoff_menu_cmd="$self_arg handoff-menu $sid_arg $cwd_arg $pane_arg $flags_arg"

fork_split_right_n="run-shell $(tmux_quote "$prompt_right_cmd")"
fork_split_down_n="run-shell $(tmux_quote "$prompt_down_cmd")"
fork_window_n="run-shell $(tmux_quote "$prompt_window_cmd")"
fork_wt="run-shell $(tmux_quote "$prompt_worktree_cmd")"
fork_wts_n="run-shell $(tmux_quote "$prompt_worktrees_cmd")"
handoff_menu="run-shell $(tmux_quote "$handoff_menu_cmd")"

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
	"Handoff → Claude" "x" "$handoff_menu" \
	"" \
	"Copy fork command" "c" "set-buffer -w -- \"$fork_cmd\" ; display-message \"Copied fork command\"" \
	"Copy session id" "y" "set-buffer -w -- \"$sid\" ; display-message \"Copied session id\""
