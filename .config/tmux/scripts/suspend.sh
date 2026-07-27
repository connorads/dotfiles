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

set_options_for_suspended_state() {
	local -r escaped_delim="${RANDOM}${RANDOM}${RANDOM}"

	local _options="${1#,}"
	_options="${_options//\\,/${escaped_delim}}"
	IFS=, read -ra options <<<"${_options}"

	local flags=""
	local name=""
	local value=""

	local resumed_options=""
	for item in "${options[@]}"; do
		if [[ -z "$(echo "${item}" | xargs)" ]]; then
			continue
		fi

		name="$(echo "${item%%:*}" | xargs)"
		item="${item#*:}"
		flags="${item%%:*}"
		value="${item#*:}"
		value="${value//${escaped_delim}/,}"

		has_value="$(tmux show-options -qv"${flags}" "${name}" | wc -l | xargs)"
		preserved_flags="${flags}"
		if [[ "${has_value}" = "0" ]]; then
			preserved_flags="${preserved_flags}u"
		fi
		preserved_value="$(tmux show-options -qv"${flags}" "${name}")"
		resumed_options="${resumed_options},${name}:${preserved_flags}:${preserved_value//,/\\,}"

		tmux set-option -q"${flags}" "${name}" "${value}"
	done

	tmux set-option -q '@suspend_resumed_options' "${resumed_options}"
}

declare -r on_suspend_command="${1}"
declare -r suspended_options="${2}"

tmux set-option -q '@suspend_prefix' "$(tmux show-option -qv prefix)"

tmux set-option -q prefix none \; set-option key-table suspended \; \
	if-shell -F '#{pane_in_mode}' 'send-keys -X cancel' \; \
	if-shell -F '#{pane_synchronized}' 'set synchronize-panes off'

set_options_for_suspended_state "${suspended_options}"

eval "${on_suspend_command}"

tmux refresh-client -S
