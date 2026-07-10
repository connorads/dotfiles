# shellcheck shell=bash
# Shared shell helpers for tmux skill scripts.

tmux_socket_name=""
tmux_socket_path=""
tmux_socket_args=()

tmux_common_require_arg() {
	local option=$1
	if [[ $# -lt 2 || -z ${2:-} ]]; then
		echo "Error: $option requires an argument" >&2
		return 1
	fi
}

tmux_common_set_socket_name() {
	if [[ -n "$tmux_socket_path" ]]; then
		echo "Error: -L and -S are mutually exclusive" >&2
		return 1
	fi
	tmux_socket_name=$1
	tmux_socket_args=(-L "$1")
}

tmux_common_set_socket_path() {
	if [[ -n "$tmux_socket_name" ]]; then
		echo "Error: -L and -S are mutually exclusive" >&2
		return 1
	fi
	tmux_socket_path=$1
	tmux_socket_args=(-S "$1")
}

tmux_common_build_cmd() {
	# shellcheck disable=SC2034 # Assigned for scripts that source this file.
	tmux_cmd=(tmux "${tmux_socket_args[@]}")
}
