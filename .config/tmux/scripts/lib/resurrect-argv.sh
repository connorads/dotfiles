#!/usr/bin/env bash
# resurrect-argv.sh: rebuild agent resume commands from the saved pane argv.
# Sourced (not executed) by the tmux-resurrect strategy scripts.
#
# tmux-resurrect passes the saved full command (from `ps -o args=`, aliases
# pre-expanded) as $1 to strategy scripts. Rebuilding from it preserves flags
# a bare "<agent> --resume <id>" would drop (permission mode, system-prompt
# append, model...) - none of the three CLIs persist those in the session.
#
# Contract per function: echo the rebuilt command and return 0, or return 1
# when the saved argv0 is not the expected agent (caller falls back to the
# bare command). Stale resume/continue state is stripped first so restore is
# idempotent across repeated save/restore cycles. Unknown tokens are kept
# verbatim and in order, so flag+value pairs survive without a flag table.
# The canonical bare command word is always emitted, never argv0's path.

# _resurrect_argv0_matches <expected> <argv0>
# True when argv0's basename is the expected agent command.
_resurrect_argv0_matches() {
	[ "${2##*/}" = "$1" ]
}

# _resurrect_squote <value>
# Single-quote a value for typing into the pane's shell ('\'' escaping).
_resurrect_squote() {
	local v="${1//\'/\'\\\'\'}"
	printf "'%s'" "$v"
}

# resurrect_argv_claude <saved_command> <session_id>
# Emit "claude <kept-flags> --resume <sid>"; empty sid -> "... --continue".
resurrect_argv_claude() {
	local -a tokens
	read -ra tokens <<<"$1"
	local sid="$2"
	[ "${#tokens[@]}" -gt 0 ] || return 1
	_resurrect_argv0_matches claude "${tokens[0]}" || return 1

	local kept="" i=1 tok
	while [ "$i" -lt "${#tokens[@]}" ]; do
		tok="${tokens[$i]}"
		case "$tok" in
		--resume | -r)
			# Consume the session-id value when present.
			i=$((i + 1))
			if [ "$i" -lt "${#tokens[@]}" ] && [[ "${tokens[$i]}" != -* ]]; then
				i=$((i + 1))
			fi
			continue
			;;
		--resume=* | --continue | -c | --fork-session) ;;
		*)
			kept="${kept:+$kept }$tok"
			;;
		esac
		i=$((i + 1))
	done

	if [ -n "$sid" ]; then
		echo "claude${kept:+ $kept} --resume $sid"
	else
		echo "claude${kept:+ $kept} --continue"
	fi
}

# resurrect_argv_codex <saved_command> <session_id>
# Emit "codex resume <sid> <kept-flags>"; empty sid -> "codex resume --last ...".
# Note: codex's -c takes a key=val value (unlike claude's bare -c) - kept verbatim.
resurrect_argv_codex() {
	local -a tokens
	read -ra tokens <<<"$1"
	local sid="$2"
	[ "${#tokens[@]}" -gt 0 ] || return 1
	_resurrect_argv0_matches codex "${tokens[0]}" || return 1

	local kept="" i=1 tok
	while [ "$i" -lt "${#tokens[@]}" ]; do
		tok="${tokens[$i]}"
		case "$tok" in
		resume)
			# Consume the positional session-id when present.
			i=$((i + 1))
			if [ "$i" -lt "${#tokens[@]}" ] && [[ "${tokens[$i]}" != -* ]]; then
				i=$((i + 1))
			fi
			continue
			;;
		--last) ;;
		*)
			kept="${kept:+$kept }$tok"
			;;
		esac
		i=$((i + 1))
	done

	if [ -n "$sid" ]; then
		echo "codex resume $sid${kept:+ $kept}"
	else
		echo "codex resume --last${kept:+ $kept}"
	fi
}

# resurrect_argv_opencode <saved_command> <session_id> [env_value]
# Emit "opencode <kept-flags> --session <sid>"; empty sid -> "... --continue".
# env_value: recorded OPENCODE_CONFIG_CONTENT (invisible in argv - e.g. ocy's
# yolo config); prefixed as an inline env assignment when non-empty, which
# works because resurrect types the command into the pane's shell.
resurrect_argv_opencode() {
	local -a tokens
	read -ra tokens <<<"$1"
	local sid="$2" env_value="${3:-}"
	[ "${#tokens[@]}" -gt 0 ] || return 1
	_resurrect_argv0_matches opencode "${tokens[0]}" || return 1

	local kept="" i=1 tok
	while [ "$i" -lt "${#tokens[@]}" ]; do
		tok="${tokens[$i]}"
		case "$tok" in
		--session | -s)
			# Consume the session-id value when present.
			i=$((i + 1))
			if [ "$i" -lt "${#tokens[@]}" ] && [[ "${tokens[$i]}" != -* ]]; then
				i=$((i + 1))
			fi
			continue
			;;
		--session=* | --continue | -c | --fork) ;;
		*)
			kept="${kept:+$kept }$tok"
			;;
		esac
		i=$((i + 1))
	done

	local cmd
	if [ -n "$sid" ]; then
		cmd="opencode${kept:+ $kept} --session $sid"
	else
		cmd="opencode${kept:+ $kept} --continue"
	fi
	if [ -n "$env_value" ]; then
		cmd="OPENCODE_CONFIG_CONTENT=$(_resurrect_squote "$env_value") $cmd"
	fi
	echo "$cmd"
}
