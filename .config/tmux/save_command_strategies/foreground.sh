#!/usr/bin/env bash
# foreground.sh: tmux-resurrect save-command strategy that also records panes
# whose top-level process IS the agent.
#
# Upstream's `ps` strategy finds a pane's command as a *child of pane_pid*. A
# pane created by `tmux split-window '<cmd>'` - the branch/fork menu - has the
# shell exec the command, so pane_pid IS the agent and no such child exists: the
# saved full-command field comes out empty and restore.sh filters those pane
# lines out before any restore strategy runs, so the pane silently returns as a
# bare shell. The fallback here asks tmux for the pane's own foreground command
# and resolves its PID by tty, which covers both broken shapes (exec'd agent, and
# a re-parented/grandchild agent found by tty rather than parentage). It shares
# `agent_foreground_pid_for_tty` with the session-id save hook, so both halves of
# the subsystem agree on how to find a pane's agent.
#
# The child scan stays primary, so panes upstream already handles keep
# byte-identical output. A missing copy of this file in the plugin's
# save_command_strategies/ dir falls back to the bundled `ps` strategy.

PANE_PID="$1"

# shellcheck source=../scripts/lib/agent-session.sh disable=SC1091
[ -f "$HOME/.config/tmux/scripts/lib/agent-session.sh" ] &&
	. "$HOME/.config/tmux/scripts/lib/agent-session.sh"

# Upstream's child scan, with an exact ppid compare: its `grep "^$PANE_PID"`
# prefix match can attribute pid 21350's command to pane pid 2135.
child_command() {
	ps -ao ppid,args 2>/dev/null |
		awk -v ppid="$PANE_PID" '
			$1 == ppid {
				sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
				print
				exit
			}'
}

# A pane whose foreground process is an idle shell must stay empty - that is what
# upstream's semantics mean. Covers the configured default-shell plus the usual
# login shells.
is_shell() {
	local cmd="$1" default_shell
	default_shell="$(tmux show -gv default-shell 2>/dev/null)"
	default_shell="${default_shell##*/}"
	case "$cmd" in
	sh | bash | zsh | fish | dash | ksh | tcsh | csh | nu)
		return 0
		;;
	esac
	[ -n "$default_shell" ] && [ "$cmd" = "$default_shell" ]
}

# tmux's own idea of the pane: its tty and foreground command name.
foreground_command() {
	local row tty cmd pid
	row=$(tmux list-panes -a -F '#{pane_pid}	#{pane_tty}	#{pane_current_command}' 2>/dev/null |
		awk -F'\t' -v pid="$PANE_PID" '$1 == pid { print; exit }')
	[ -n "$row" ] || return 0

	IFS=$'\t' read -r _ tty cmd <<<"$row"
	[ -n "$cmd" ] || return 0
	is_shell "$cmd" && return 0
	command -v agent_foreground_pid_for_tty >/dev/null 2>&1 || return 0

	pid=$(agent_foreground_pid_for_tty "$tty" "$cmd" "$PANE_PID")
	[ -n "$pid" ] || return 0
	ps -o args= -p "$pid" 2>/dev/null
}

main() {
	# Upstream's exit_safely_if_empty_ppid.
	[ -n "$PANE_PID" ] || exit 0

	local full_command
	full_command=$(child_command)
	[ -n "$full_command" ] || full_command=$(foreground_command)
	[ -n "$full_command" ] || return 0
	printf '%s\n' "$full_command"
}
main
