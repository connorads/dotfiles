#!/bin/sh
# session-popup.sh — fzf popup to switch to an existing tmux session or create a
# new one by typing a name. Fills the "create-from-a-key" gap: prefix + s
# (choose-tree) only switches between sessions that already exist.
#
#   session-popup.sh          # pick (default): list | fzf | switch/create
#   session-popup.sh switch NAME  # switch to NAME, creating it detached if absent
#
# Split into subcommands so switch/create is unit-testable without driving fzf
# (which needs a real TTY). Bound to `prefix + S` via display-popup -E. A bare
# `tmux switch-client` from inside display-popup -E moves the real underlying
# client (same idiom as agent-popup.sh's jump).

set -u

# switch NAME — focus session NAME, creating it detached first if it does not
# exist. The create-or-switch core; unit-tested.
switch() {
	_name=${1:-}
	[ -n "$_name" ] || {
		echo "usage: session-popup.sh switch <name>" >&2
		exit 2
	}
	tmux has-session -t="$_name" 2>/dev/null || tmux new-session -ds "$_name"
	tmux switch-client -t "$_name"
}

# pick — list sessions in fzf; Enter switches to the highlighted one, or type a
# name that matches nothing to create + switch to it. --print-query emits the
# typed query as its own line; a matched selection follows on the next line, so
# the last non-empty line is "the selection if any, else the typed name". Esc
# (empty) → no-op.
pick() {
	_choice=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | fzf \
		--print-query --reverse --info=hidden \
		--prompt='session › ' \
		--header='enter: switch · type a new name to create') || true

	_name=$(printf '%s\n' "$_choice" | grep -v '^$' | tail -n1)
	[ -n "$_name" ] || return 0
	switch "$_name"
}

case "${1:-}" in
switch)
	shift
	switch "${1:-}"
	;;
pick | "") pick ;;
*)
	echo "usage: session-popup.sh [pick|switch <name>]" >&2
	exit 2
	;;
esac
