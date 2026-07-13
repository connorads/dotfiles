#!/usr/bin/env bash
# Wait for a text pattern in a tmux pane.
# Usage: wait-for-text.sh [-L SOCKET_NAME|-S SOCKET_PATH] [--control] -t session:0.0 -p '^>>>' -T 15

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tmux_cmd=()
tmux_socket_args=()
# shellcheck disable=SC1091
source "$script_dir/tmux-common.sh"

usage() {
	cat <<EOF
Usage: $(basename "$0") [-L SOCKET_NAME|-S SOCKET_PATH] [--control] -t TARGET -p PATTERN [-T TIMEOUT] [-i INTERVAL]

Wait until a pattern appears in tmux pane output.

Options:
  -t TARGET      tmux target (session, session:window, pane id, or session:window.pane)
  -p PATTERN     grep ERE to wait for; Python regex when --control is used
  -T TIMEOUT     timeout in seconds (default: 30)
  -i INTERVAL    poll interval in seconds (default: 0.5; ignored with --control)
  -L SOCKET_NAME use a named tmux socket
  -S SOCKET_PATH use a tmux socket path
  --control      attach in tmux control mode and follow output events
  -h, --help     show this help

Examples:
  $(basename "$0") -t mysession -p '^>>>'                  # capture-poll for Python prompt
  $(basename "$0") --control -t dev:%1 -p 'gdb>' -T 60     # event-driven wait
  $(basename "$0") -L private -t repl -p 'error' -i 0.2    # named socket
EOF
	exit 1
}

target=""
pattern=""
timeout=30
interval=0.5
control=false

while [[ $# -gt 0 ]]; do
	case $1 in
	-t)
		tmux_common_require_arg "$@" || usage
		target=$2
		shift 2
		;;
	-p)
		tmux_common_require_arg "$@" || usage
		pattern=$2
		shift 2
		;;
	-T)
		tmux_common_require_arg "$@" || usage
		timeout=$2
		shift 2
		;;
	-i)
		tmux_common_require_arg "$@" || usage
		interval=$2
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
	--control)
		control=true
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

[[ -z "$target" ]] && {
	echo "Error: -t TARGET required" >&2
	usage
}
[[ -z "$pattern" ]] && {
	echo "Error: -p PATTERN required" >&2
	usage
}

tmux_common_build_cmd

if $control; then
	control_args=("$script_dir/control-tail.py" "${tmux_socket_args[@]}")
	exec "${control_args[@]}" -t "$target" -p "$pattern" -T "$timeout"
fi

if ! "${tmux_cmd[@]}" display-message -p -t "$target" "#{pane_id}" >/dev/null 2>&1; then
	echo "Error: tmux target '$target' does not exist" >&2
	exit 1
fi

elapsed=0
while awk "BEGIN{exit !($elapsed < $timeout)}"; do
	output=$("${tmux_cmd[@]}" capture-pane -t "$target" -p 2>/dev/null || true)
	if echo "$output" | grep -qE "$pattern"; then
		echo "Pattern '$pattern' found after ${elapsed}s"
		exit 0
	fi
	sleep "$interval"
	elapsed=$(awk "BEGIN{print $elapsed + $interval}")
done

echo "Timeout (${timeout}s) waiting for pattern '$pattern'" >&2
echo "Last output:" >&2
"${tmux_cmd[@]}" capture-pane -t "$target" -p | tail -20 >&2
exit 1
