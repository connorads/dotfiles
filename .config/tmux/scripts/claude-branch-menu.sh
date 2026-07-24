#!/usr/bin/env bash
# claude-branch-menu.sh: fork the focused pane's live Claude session into a new
# pane/window (prefix + Alt+b). Resolves pane -> claude PID -> the live
# ~/.claude/sessions/<pid>.json golden source, then offers a display-menu palette
# that runs `claude <source-flags> -r <sid> --fork-session` in a split/window
# (spatial branch: the fork mirrors the source pane's live launch flags - append,
# model, perm mode - via resurrect_argv_claude_flags, like the restore path, so a
# fork of a non-yolo pane stays non-yolo; the original pane is left untouched).
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
	local config_dir=${2:-}
	local flags=${3:-}

	# A ccp pane relocates the account to CLAUDE_CONFIG_DIR; tmux panes don't
	# inherit the source pane's env, so the fork must carry it inline or it would
	# launch under the default ~/.claude (resume fails / cross-bills). The ccp
	# profile-name regex forbids spaces, so the inline VAR=val prefix is POSIX-sh
	# safe under tmux's `sh -c`. Empty = default account.
	local prefix=""
	[ -n "$config_dir" ] && prefix="CLAUDE_CONFIG_DIR=$(shell_quote "$config_dir") "

	# flags mirrors the source pane's launch flags (append/model/skip-perms) from
	# resurrect_argv_claude_flags. Inserted unquoted so it word-splits back into
	# separate flags; the append path has no spaces (the assumption that lib
	# documents). Empty flags -> bare fork (a source with no override to carry).
	printf '%sclaude%s -r %s --fork-session' "$prefix" "${flags:+ $flags}" "$(shell_quote "$sid")"
}

# claude_handoff_cmd <sid> [config_dir]
# Hand the pane's live Claude session off to Codex: translate its transcript into
# Codex's store and resume it there (handoff self-opens the target in foreground,
# so no --no-open). Carries the source CLAUDE_CONFIG_DIR inline (same reason as
# claude_fork_cmd - tmux panes don't inherit the source env) so handoff resolves
# the source under the right account; empty = default ~/.claude. Uses the absolute
# ~/.local/bin wrapper path because the tmux server's PATH may not carry that dir.
claude_handoff_cmd() {
	local sid=$1
	local config_dir=${2:-}

	local prefix=""
	[ -n "$config_dir" ] && prefix="CLAUDE_CONFIG_DIR=$(shell_quote "$config_dir") "

	printf '%s%s --from claude --to codex %s' \
		"$prefix" "$(shell_quote "$HOME/.local/bin/handoff")" "$(shell_quote "$sid")"
}

fork_worktree_window() {
	local branch=$1
	local sid=$2
	local config_dir=${3:-}
	local flags=${4:-}
	local path

	path=$(wt-add "$branch") || soft_fail "wt-add failed for $branch"
	tmux new-window -c "$path" "$(claude_fork_cmd "$sid" "$config_dir" "$flags")"
}

# render_branch_menu <split_target> <pane_target> <cwd> <sid> <config_dir> <flags> <title> <with_account>
# Draw the fork palette (splits / windows / worktrees / xN + copy rows). Shared
# by two renders so account choice composes with every placement rather than
# being a placement of its own: the SOURCE render (the pane's own account,
# with_account=1) offers a "Fork → other ACCOUNT" row; picking one lands in the
# account-chosen mode, which relocates the transcript then calls this SAME
# function for the target account (with_account=0) - so the target gets the
# identical split/window/worktree vocabulary. split_target drives the direct
# split/new-window -t (the source pane); the xN prompt modes carry pane_target
# (the stable session:window.pane form). with_account=0 omits the account row so
# you never chain account -> account -> account.
render_branch_menu() {
	local split_target=$1
	local pane_target=$2
	local cwd=$3
	local sid=$4
	local config_dir=$5
	local flags=$6
	local title=$7
	local with_account=${8:-0}

	local self self_arg pane_arg cwd_arg sid_arg config_dir_arg flags_arg fork_cmd
	self="${BASH_SOURCE[0]}"
	self_arg=$(shell_quote "$self")
	pane_arg=$(shell_quote "$pane_target")
	cwd_arg=$(shell_quote "$cwd")
	sid_arg=$(shell_quote "$sid")
	config_dir_arg=$(shell_quote "$config_dir")
	# The mirrored flags carry spaces (append path + value); shell_quote threads
	# them as one positional that expands unquoted back into separate flags in
	# claude_fork_cmd - the same round-trip config_dir uses.
	flags_arg=$(shell_quote "$flags")
	fork_cmd=$(claude_fork_cmd "$sid" "$config_dir" "$flags")

	local prompt_right_cmd prompt_down_cmd prompt_window_cmd prompt_worktree_cmd prompt_worktrees_cmd
	prompt_right_cmd="$self_arg prompt-repeat split-right $pane_arg $cwd_arg $sid_arg $config_dir_arg $flags_arg"
	prompt_down_cmd="$self_arg prompt-repeat split-down $pane_arg $cwd_arg $sid_arg $config_dir_arg $flags_arg"
	prompt_window_cmd="$self_arg prompt-repeat new-window $pane_arg $cwd_arg $sid_arg $config_dir_arg $flags_arg"
	prompt_worktree_cmd="$self_arg prompt-worktree $cwd_arg $sid_arg $config_dir_arg $flags_arg"
	prompt_worktrees_cmd="$self_arg prompt-worktrees $cwd_arg $sid_arg $config_dir_arg $flags_arg"

	# Handoff → Codex opens a placement submenu (same one-row→submenu idiom as the
	# account row). It carries this render's config_dir so the source resolves.
	local handoff_menu_cmd
	handoff_menu_cmd="$self_arg handoff-menu $sid_arg $config_dir_arg $cwd_arg $pane_arg"

	local -a menu
	menu=(
		"Split right" "|" "split-window -h -t $split_target -c \"$cwd\" \"$fork_cmd\""
		"Split right x N" "R" "run-shell $(tmux_quote "$prompt_right_cmd")"
		"Split down" "-" "split-window -v -t $split_target -c \"$cwd\" \"$fork_cmd\""
		"Split down x N" "D" "run-shell $(tmux_quote "$prompt_down_cmd")"
		"New window" "w" "new-window -c \"$cwd\" \"$fork_cmd\""
		"New windows x N" "N" "run-shell $(tmux_quote "$prompt_window_cmd")"
		""
		"Fork → new WORKTREE window" "W" "run-shell $(tmux_quote "$prompt_worktree_cmd")"
		"WORKTREE windows x N" "T" "run-shell $(tmux_quote "$prompt_worktrees_cmd")"
		""
	)
	if [ "$with_account" = 1 ]; then
		# The account picker forks FROM this render's config_dir, so it threads
		# config_dir as the source to exclude + copy from. pane_target rides
		# along so the target render can split next to this pane.
		local account_menu_cmd account_action
		account_menu_cmd="$self_arg account-menu $sid_arg $config_dir_arg $flags_arg $cwd_arg $pane_arg"
		account_action="run-shell $(tmux_quote "$account_menu_cmd")"
		menu+=("Fork → other ACCOUNT" "a" "$account_action" "")
	fi
	menu+=("Handoff → Codex" "x" "run-shell $(tmux_quote "$handoff_menu_cmd")" "")
	menu+=(
		"Copy fork command" "c" "set-buffer -w -- \"$fork_cmd\" ; display-message \"Copied fork command\""
		"Copy session id" "y" "set-buffer -w -- \"$sid\" ; display-message \"Copied session id\""
	)

	tmux display-menu -T "$title" -x C -y C "${menu[@]}"
}

# claude_account_label <config_dir>
# Human name for an account: "default" for empty / ~/.claude, else the profile
# dir basename. Used in the account picker title and target menu title.
claude_account_label() {
	local config_dir=${1:-}
	# Strip any trailing slash so the basename never comes back empty.
	config_dir="${config_dir%/}"
	if [ -z "$config_dir" ] || [ "$config_dir" = "$HOME/.claude" ]; then
		printf 'default'
	else
		printf '%s' "${config_dir##*/}"
	fi
}

# Script modes are used by menu commands after the live session has already
# been resolved, so keep them before the jq/session discovery path.
case "${1:-}" in
prompt-repeat)
	{ [ "$#" -ge 5 ] && [ "$#" -le 7 ]; } || soft_fail "usage: prompt-repeat <split-right|split-down|new-window> <pane-id> <cwd> <session-id> [config-dir] [flags]"
	action=$2
	case "$action" in
	split-right | split-down | new-window) ;;
	*) soft_fail "Unknown fork action: $action" ;;
	esac
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	pane_arg=$(shell_quote "$3")
	cwd_arg=$(shell_quote "$4")
	sid_arg=$(shell_quote "$5")
	config_dir_arg=$(shell_quote "${6:-}")
	flags_arg=$(shell_quote "${7:-}")
	repeat_cmd="$self_arg fork-repeat $action %% $pane_arg $cwd_arg $sid_arg $config_dir_arg $flags_arg"
	tmux command-prompt -I "4" -p "Fork count:" "run-shell $(tmux_quote "$repeat_cmd")"
	exit 0
	;;
prompt-worktree)
	{ [ "$#" -ge 3 ] && [ "$#" -le 5 ]; } || soft_fail "usage: prompt-worktree <cwd> <session-id> [config-dir] [flags]"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd=$2
	sid_arg=$(shell_quote "$3")
	config_dir_arg=$(shell_quote "${4:-}")
	flags_arg=$(shell_quote "${5:-}")
	worktree_cmd="$self_arg fork-worktree %% $sid_arg $config_dir_arg $flags_arg"
	tmux command-prompt -p "Worktree branch:" "display-popup -E -w 80% -h 60% -d $(tmux_quote "$cwd") $(tmux_quote "$worktree_cmd")"
	exit 0
	;;
prompt-worktrees)
	{ [ "$#" -ge 3 ] && [ "$#" -le 5 ]; } || soft_fail "usage: prompt-worktrees <cwd> <session-id> [config-dir] [flags]"
	self_arg=$(shell_quote "${BASH_SOURCE[0]}")
	cwd=$2
	sid_arg=$(shell_quote "$3")
	config_dir_arg=$(shell_quote "${4:-}")
	flags_arg=$(shell_quote "${5:-}")
	worktrees_cmd="$self_arg fork-worktrees %% %2 $sid_arg $config_dir_arg $flags_arg"
	tmux command-prompt -I "4," -p "Fork count:,Worktree branch prefix:" "display-popup -E -w 80% -h 60% -d $(tmux_quote "$cwd") $(tmux_quote "$worktrees_cmd")"
	exit 0
	;;
fork-repeat)
	{ [ "$#" -ge 6 ] && [ "$#" -le 8 ]; } || soft_fail "usage: fork-repeat <split-right|split-down|new-window> <count> <pane-id> <cwd> <session-id> [config-dir] [flags]"
	action=$2
	count=$(normalise_fork_count "$3") ||
		soft_fail "Fork count must be between 1 and 8: ${3:-<empty>}"
	pane_id=$4
	cwd=$5
	sid=$6
	config_dir=${7:-}
	flags=${8:-}
	fork_cmd=$(claude_fork_cmd "$sid" "$config_dir" "$flags")
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
	{ [ "$#" -ge 3 ] && [ "$#" -le 5 ]; } || soft_fail "usage: fork-worktree <branch> <session-id> [config-dir] [flags] (branch must not contain spaces)"
	branch=$2
	sid=$3
	config_dir=${4:-}
	flags=${5:-}
	case "$branch" in
	*[[:space:]]*) soft_fail "Branch name must not contain spaces: $branch" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	fork_worktree_window "$branch" "$sid" "$config_dir" "$flags"
	exit 0
	;;
fork-worktrees)
	PATH="$HOME/.local/bin:$PATH"
	{ [ "$#" -ge 4 ] && [ "$#" -le 6 ]; } || soft_fail "usage: fork-worktrees <count> <branch-prefix> <session-id> [config-dir] [flags] (prefix must not contain spaces)"
	count=$(normalise_fork_count "$2") ||
		soft_fail "Fork count must be between 1 and 8: ${2:-<empty>}"
	prefix=$3
	sid=$4
	config_dir=${5:-}
	flags=${6:-}
	[ -n "$prefix" ] || soft_fail "Worktree branch prefix is required"
	case "$prefix" in
	*[[:space:]]*) soft_fail "Branch prefix must not contain spaces: $prefix" ;;
	esac
	git rev-parse --show-toplevel >/dev/null 2>&1 ||
		soft_fail "Not in a git repository: $PWD"
	for ((i = 1; i <= count; i++)); do
		fork_worktree_window "$prefix-$i" "$sid" "$config_dir" "$flags"
	done
	exit 0
	;;
account-menu)
	# Step 1 of the cross-account fork: show a display-menu of the *other*
	# accounts (default + each ccp profile, the source excluded). Reached via
	# run-shell from the source branch menu's "Fork → other ACCOUNT" row, so it
	# renders like the rest of the branch menu (no popup/fzf). The title names
	# the source account, so its own absence from the list is self-explaining.
	{ [ "$#" -ge 6 ] && [ "$#" -le 6 ]; } || soft_fail "usage: account-menu <sid> <source-config-dir> <flags> <cwd> <pane-target>"
	sid=$2
	source_config_dir=$3
	flags=$4
	cwd=$5
	pane_target=$6

	account_lib="$(dirname "${BASH_SOURCE[0]}")/lib/claude-account.sh"
	[ -f "$account_lib" ] || soft_fail "missing lib: $account_lib"
	# shellcheck source=lib/claude-account.sh disable=SC1091
	. "$account_lib"

	self="${BASH_SOURCE[0]}"
	self_arg=$(shell_quote "$self")
	sid_arg=$(shell_quote "$sid")
	flags_arg=$(shell_quote "$flags")
	cwd_arg=$(shell_quote "$cwd")
	pane_arg=$(shell_quote "$pane_target")
	src_arg=$(shell_quote "$source_config_dir")
	src_label=$(claude_account_label "$source_config_dir")

	acct_menu=()
	acct_i=0
	while IFS=$'\t' read -r acct_label acct_dir; do
		[ -n "$acct_dir" ] || continue
		acct_i=$((acct_i + 1))
		# 1-9 give mnemonic number keys; extras stay arrow-selectable.
		acct_key=""
		[ "$acct_i" -le 9 ] && acct_key="$acct_i"
		dir_arg=$(shell_quote "$acct_dir")
		chosen_cmd="$self_arg account-chosen $sid_arg $dir_arg $flags_arg $cwd_arg $pane_arg $src_arg"
		acct_menu+=("$acct_label" "$acct_key" "run-shell $(tmux_quote "$chosen_cmd")")
	done < <(account_candidates "$source_config_dir")

	if [ "${#acct_menu[@]}" -eq 0 ]; then
		tmux display-message "No other account to fork into (only $src_label exists)"
		exit 0
	fi

	tmux display-menu -T " Fork from $src_label → account " -x C -y C "${acct_menu[@]}"
	exit 0
	;;
account-chosen)
	# Step 2: an account was picked. Copy the transcript into its projects/ tree,
	# materialise its shared config, then re-render the placement palette for the
	# target account (with_account=0 - no further account hop). Native
	# --fork-session then mints a fresh id under the target dir, leaving the
	# origin running untouched under the source account.
	{ [ "$#" -ge 7 ] && [ "$#" -le 7 ]; } || soft_fail "usage: account-chosen <sid> <target-dir> <flags> <cwd> <pane-target> <source-config-dir>"
	sid=$2
	target_dir=$3
	flags=$4
	cwd=$5
	pane_target=$6
	source_config_dir=$7

	# claude-profile-materialise is a dual-mode zsh function exposed via
	# ~/.local/bin; the tmux server's PATH may not carry that dir.
	PATH="$HOME/.local/bin:$PATH"

	account_lib="$(dirname "${BASH_SOURCE[0]}")/lib/claude-account.sh"
	[ -f "$account_lib" ] || soft_fail "missing lib: $account_lib"
	# shellcheck source=lib/claude-account.sh disable=SC1091
	. "$account_lib"

	if ! relocate_transcript "$source_config_dir" "$target_dir" "$cwd" "$sid" >/dev/null; then
		tmux display-message "Could not copy the transcript into the target account"
		exit 0
	fi

	# Never materialise onto the shared ~/.claude itself (the base profiles
	# derive from).
	if [ "$target_dir" != "$HOME/.claude" ] && command -v claude-profile-materialise >/dev/null 2>&1; then
		claude-profile-materialise "$target_dir" || true
	fi

	tgt_label=$(claude_account_label "$target_dir")
	# split_target = pane_target (the stable id) so a split lands next to the
	# origin pane even from this run-shell context.
	render_branch_menu "$pane_target" "$pane_target" "$cwd" "$sid" "$target_dir" "$flags" " Branch → $tgt_label " 0
	exit 0
	;;
handoff-menu)
	# The Handoff → Codex placement submenu (split right/down / new window),
	# reached via run-shell from the branch menu's "Handoff → Codex" row. Like
	# account-chosen it runs from a run-shell context, so it splits against the
	# stable pane_target (session:window.pane), not "%N".
	[ "$#" -eq 5 ] || soft_fail "usage: handoff-menu <sid> <config-dir> <cwd> <pane-target>"
	sid=$2
	config_dir=$3
	cwd=$4
	pane_target=$5

	handoff_cmd=$(claude_handoff_cmd "$sid" "$config_dir")
	tmux display-menu -T " Handoff → Codex " -x C -y C \
		"Split right" "|" "split-window -h -t $pane_target -c \"$cwd\" \"$handoff_cmd\"" \
		"Split down" "-" "split-window -v -t $pane_target -c \"$cwd\" \"$handoff_cmd\"" \
		"New window" "w" "new-window -c \"$cwd\" \"$handoff_cmd\""
	exit 0
	;;
esac

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

# resurrect_argv_claude_flags preserves the source pane's launch flags so the
# fork mirrors it (the same lib the restore path uses). Guarded on existence
# like the resurrect strategy does; missing -> empty flags -> bare fork.
# shellcheck source=lib/resurrect-argv.sh disable=SC1091
[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/resurrect-argv.sh" ] &&
	. "$(dirname "${BASH_SOURCE[0]}")/lib/resurrect-argv.sh"

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

# A ccp pane runs under CLAUDE_CONFIG_DIR; its session lives under that dir, not
# ~/.claude, and the fork must carry the account through. Empty = default account.
config_dir=$(claude_config_dir_for_pid "$claude_pid")

meta=$(claude_session_meta_for_pid "$claude_pid" "$config_dir")
if [ -z "$meta" ]; then
	resolved=$(claude_session_resolve_for_pid "$claude_pid" "$pane_id" "$pane_path" "$config_dir" 2>/dev/null || true)
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
# Mirror the source pane's launch flags (append, model, perm mode) into the fork,
# like the resurrect restore path - a fork of a non-yolo pane stays non-yolo.
# resurrect_argv_claude_flags keeps them verbatim, strips the source's own stale
# -r/--fork-session/--continue (clean fork-of-fork), and returns non-zero on
# argv0 mismatch (wrapper) - empty fork_flags then yields a bare fork.
fork_flags=""
if command -v resurrect_argv_claude_flags >/dev/null 2>&1; then
	fork_flags=$(resurrect_argv_claude_flags "$(ps -o args= -p "$claude_pid")" 2>/dev/null || true)
fi

# pane_target is the stable session:window.pane id the xN prompt modes carry;
# pane_id ("%N") drives the direct split/new-window -t. with_account=1 adds the
# "Fork → other ACCOUNT" row (source render only).
pane_target=$(tmux display-message -p -t "$pane_id" '#{session_id}:#{window_id}.#{pane_index}' 2>/dev/null || true)
[ -n "$pane_target" ] || pane_target="$pane_id"

render_branch_menu "$pane_id" "$pane_target" "$cwd" "$sid" "$config_dir" "$fork_flags" "$title" 1
