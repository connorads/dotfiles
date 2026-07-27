#!/usr/bin/env bash

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

set -eu

set_options_for_resumed_state() {
	local -r escaped_delim="${RANDOM}${RANDOM}${RANDOM}"

	local _options="${1#,}"
	_options="${_options//\\,/${escaped_delim}}"
	IFS=, read -ra options <<<"${_options}"

	local flags=""
	local name=""
	local value=""

	for item in "${options[@]}"; do
		name="$(echo "${item%%:*}" | xargs)"
		item="${item#*:}"
		flags="${item%%:*}"
		value="${item#*:}"
		value="${value//${escaped_delim}/,}"

		tmux set-option -q"${flags}" "${name}" "${value}"
	done
}

declare -r on_resume_command="${1}"
resumed_options="$(tmux show-option -qv '@suspend_resumed_options')"
declare -r resumed_options

prefix="$(tmux show-option -qv '@suspend_prefix')"
declare -r prefix
declare prefix_flags=""
if [[ -z ${prefix} ]]; then
	prefix_flags="u"
fi

eval "${on_resume_command}"

set_options_for_resumed_state "${resumed_options}"

tmux set-option -q${prefix_flags} prefix "${prefix}" \; set-option -u key-table

tmux refresh-client -S
