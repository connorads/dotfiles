#!/usr/bin/env bash
# List tmux sessions, optionally filtered by name
# Usage: find-sessions.sh [-q QUERY] [-L SOCKET_NAME|-S SOCKET_PATH] [--all]

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tmux_cmd=()
# shellcheck disable=SC1091
source "$script_dir/tmux-common.sh"

usage() {
	cat <<EOF
Usage: $(basename "$0") [-q QUERY] [-L SOCKET_NAME|-S SOCKET_PATH] [--all]

List tmux sessions with optional filtering.

Options:
  -q QUERY        filter sessions by name (grep pattern)
  -L SOCKET_NAME  use a named tmux socket
  -S SOCKET_PATH  use a tmux socket path
  --all           show all info (windows, panes, commands)
  -h              show this help

Examples:
  $(basename "$0")                    # list all sessions
  $(basename "$0") -q claude          # sessions matching 'claude'
  $(basename "$0") --all              # detailed view
  $(basename "$0") -L private         # named socket
  $(basename "$0") -S /tmp/my.sock    # socket path
EOF
	exit 1
}

query=""
show_all=false

while [[ $# -gt 0 ]]; do
	case $1 in
	-q)
		tmux_common_require_arg "$@" || usage
		query=$2
		shift 2
		;;
	-L)
		tmux_common_require_arg "$@" || usage
		tmux_common_set_socket_name "$2" || exit 1
		shift 2
		;;
	-S)
		tmux_common_require_arg "$@" || usage
		tmux_common_set_socket_path "$2" || exit 1
		shift 2
		;;
	--all)
		show_all=true
		shift
		;;
	-h | --help)
		usage
		;;
	*)
		echo "Unknown option: $1" >&2
		usage
		;;
	esac
done

tmux_common_build_cmd

# Check if tmux server is running
if ! "${tmux_cmd[@]}" list-sessions &>/dev/null; then
	echo "No tmux sessions (server not running)" >&2
	exit 0
fi

if $show_all; then
	# Detailed view with windows and panes
	format="#{session_name}|#{session_windows}|#{session_created}|#{?session_attached,attached,detached}"
	"${tmux_cmd[@]}" list-sessions -F "$format" | while IFS='|' read -r name windows created attached; do
		[[ -n "$query" ]] && ! echo "$name" | grep -qE "$query" && continue
		created_fmt=$(date -d "@$created" '+%Y-%m-%d %H:%M' 2>/dev/null || date -r "$created" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$created")
		echo "Session: $name ($windows windows, $attached, created $created_fmt)"

		# List windows and their commands
		"${tmux_cmd[@]}" list-windows -t "$name" -F "  Window #{window_index}: #{window_name} (#{pane_current_command})" 2>/dev/null || true
	done
else
	# Simple list
	"${tmux_cmd[@]}" list-sessions -F "#{session_name}" | while read -r name; do
		[[ -n "$query" ]] && ! echo "$name" | grep -qE "$query" && continue
		echo "$name"
	done
fi
