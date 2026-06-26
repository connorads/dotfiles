#!/usr/bin/env bash
# paste-clipboard-image: paste a local screenshot path, or upload for ssh/mosh panes.
set -uo pipefail

remote_dir="${CLIPIMG_REMOTE_DIR:-/tmp/screenshots}"

usage() {
	cat <<'EOF'
Usage: paste-clipboard-image.sh
       paste-clipboard-image.sh --parse-ssh-host ARGS
       paste-clipboard-image.sh --parse-mosh-host ARGS
       paste-clipboard-image.sh --detect-host-from-ps-file PATH
EOF
}

message() {
	if command -v tmux >/dev/null 2>&1; then
		tmux display-message "$1" 2>/dev/null || true
	fi
}

split_words() {
	# Good enough for process-argv strings. Avoid eval: ps output is untrusted.
	printf '%s\n' "$1" | tr '[:space:]' '\n' | sed '/^$/d'
}

option_takes_value() {
	case "$1" in
	-b | -c | -D | -E | -e | -F | -I | -i | -J | -L | -l | -m | -O | -o | -p | -Q | -R | -S | -W | -w) return 0 ;;
	--client | --server | --ssh | --predict | --family | --port | --bind-server) return 0 ;;
	--client=* | --server=* | --ssh=* | --predict=* | --family=* | --port=* | --bind-server=*) return 1 ;;
	*) return 1 ;;
	esac
}

parse_destination() {
	local args="$1"
	local skip_command_name="${2:-}"
	local skip_next=0
	local token

	while IFS= read -r token; do
		if [ -n "$skip_command_name" ]; then
			skip_command_name=""
			case "$token" in
			ssh | */ssh | mosh | */mosh | mosh-client | */mosh-client) continue ;;
			esac
		fi

		if [ "$skip_next" -eq 1 ]; then
			skip_next=0
			continue
		fi

		case "$token" in
		--)
			skip_next=0
			continue
			;;
		-[46anv])
			continue
			;;
		-tt | -t | -T | -A | -a | -X | -x | -Y | -y | -N | -n | -f | -v | -vv | -vvv)
			continue
			;;
		-p[0-9]* | -J?* | -i?* | -l?* | -o?* | -F?*)
			continue
			;;
		--*=*)
			continue
			;;
		--*)
			if option_takes_value "$token"; then
				skip_next=1
			fi
			continue
			;;
		-*)
			if option_takes_value "$token"; then
				skip_next=1
			fi
			continue
			;;
		*)
			printf '%s\n' "$token"
			return 0
			;;
		esac
	done < <(split_words "$args")

	return 1
}

parse_ssh_host() {
	parse_destination "$1" skip_command_name
}

parse_mosh_host() {
	local args="$1"
	local original

	case "$args" in
	*' -# '*' |'*)
		original="${args#* -# }"
		original="${original%% |*}"
		;;
	*'-# '*' |'*)
		original="${args#*-# }"
		original="${original%% |*}"
		;;
	*)
		return 1
		;;
	esac

	parse_destination "$original"
}

host_from_process_args() {
	local comm="$1"
	local args="$2"
	case "$comm:$args" in
	ssh:* | */ssh:* | *:'ssh '*) parse_ssh_host "$args" ;;
	mosh-client:* | */mosh-client:* | *:'mosh-client '*) parse_mosh_host "$args" ;;
	*) return 1 ;;
	esac
}

detect_host_from_ps_stream() {
	local line pgid tpgid comm args host fallback=""

	while IFS= read -r line; do
		[ -n "$line" ] || continue
		read -r pgid tpgid comm args <<<"$line"
		[ -n "${pgid:-}" ] && [ -n "${tpgid:-}" ] && [ -n "${comm:-}" ] || continue
		host=""
		if [ "$pgid" = "$tpgid" ] && host="$(host_from_process_args "$comm" "${args:-}" 2>/dev/null)"; then
			printf '%s\n' "$host"
			return 0
		fi
		if [ -z "$fallback" ] && host="$(host_from_process_args "$comm" "${args:-}" 2>/dev/null)"; then
			fallback="$host"
		fi
	done

	if [ -n "$fallback" ]; then
		printf '%s\n' "$fallback"
		return 0
	fi

	return 1
}

detect_remote_host() {
	if [ -n "${CLIPIMG_PS_FILE:-}" ]; then
		detect_host_from_ps_stream <"$CLIPIMG_PS_FILE"
		return $?
	fi

	local tty_name
	tty_name="$(tmux display-message -p '#{pane_tty}' 2>/dev/null)" || return 1
	tty_name="${tty_name#/dev/}"
	[ -n "$tty_name" ] || return 1

	ps -t "$tty_name" -o pgid=,tpgid=,comm=,args= 2>/dev/null | detect_host_from_ps_stream
}

image_path() {
	local dir timestamp
	dir="${CLIPIMG_TMPDIR:-${TMPDIR:-/tmp}/clipboard-images}"
	timestamp="${CLIPIMG_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
	mkdir -p "$dir"
	printf '%s/clip-%s.png\n' "$dir" "$timestamp"
}

capture_clipboard_image() {
	local out
	out="$(image_path)" || return 1
	rm -f "$out"

	case "$(uname -s)" in
	Darwin)
		command -v pngpaste >/dev/null 2>&1 || return 2
		pngpaste "$out" >/dev/null 2>&1 || return 1
		;;
	*)
		if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-paste >/dev/null 2>&1; then
			wl-paste --type image/png >"$out" 2>/dev/null || return 1
		elif command -v xclip >/dev/null 2>&1; then
			xclip -selection clipboard -t image/png -o >"$out" 2>/dev/null || return 1
		else
			return 2
		fi
		;;
	esac

	[ -s "$out" ] || return 1
	printf '%s\n' "$out"
}

upload_image() {
	local host="$1"
	local local_path="$2"
	local base remote_path
	base="$(basename "$local_path")"
	remote_path="$remote_dir/$base"

	# shellcheck disable=SC2029 # remote_dir is local config expanded into a fixed mkdir command.
	ssh "$host" "mkdir -p '$remote_dir'" || return 1
	scp -q "$local_path" "$host:$remote_path" || return 1
	printf '%s\n' "$remote_path"
}

paste_path() {
	tmux set-buffer -- "$1" || return 1
	tmux paste-buffer -p || return 1
}

main() {
	case "${1:-}" in
	--parse-ssh-host)
		[ "$#" -eq 2 ] || {
			usage >&2
			return 2
		}
		parse_ssh_host "$2"
		return $?
		;;
	--parse-mosh-host)
		[ "$#" -eq 2 ] || {
			usage >&2
			return 2
		}
		parse_mosh_host "$2"
		return $?
		;;
	--detect-host-from-ps-file)
		[ "$#" -eq 2 ] || {
			usage >&2
			return 2
		}
		detect_host_from_ps_stream <"$2"
		return $?
		;;
	-h | --help)
		usage
		return 0
		;;
	esac

	local image host path
	if ! image="$(capture_clipboard_image)"; then
		message "No image on clipboard"
		return 0
	fi

	if host="$(detect_remote_host 2>/dev/null)"; then
		if path="$(upload_image "$host" "$image")"; then
			message "Uploaded image to $host:$path"
		else
			message "Image upload failed for $host"
			return 1
		fi
	else
		path="$image"
		message "Pasted local image path"
	fi

	paste_path "$path"
}

main "$@"
