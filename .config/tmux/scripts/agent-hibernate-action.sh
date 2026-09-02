#!/usr/bin/env bash
# agent-hibernate-action.sh: tmux-facing hibernate/thaw feedback adapter.
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

set -uo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENGINE=${AGENT_HIBERNATE_SH:-$SELF_DIR/agent-hibernate.sh}

action=${1:-}
pane=${2:-}
client=${3:-}
case "$action" in hibernate | thaw) ;; *) exit 2 ;; esac
[ -n "$pane" ] || exit 2

info=$(tmux display-message -p -t "$pane" '#{@agent_name}	#{window_name}' 2>/dev/null || true)
IFS=$'\t' read -r name window_name <<<"$info"
label=${name:-${window_name:-$pane}}

result_file=$(mktemp)
trap 'rm -f "$result_file"' EXIT
if "$ENGINE" "$action" "$pane" >"$result_file" 2>&1; then
	if [ "$action" = hibernate ]; then
		freed=$(sed -n 's/.* - freed / - freed /p' "$result_file" | head -n1)
		message="hibernate ✓ $label${freed:-}; Enter or Alt+Shift+Z resumes"
	else
		message="thaw ✓ $label"
	fi
	duration=4000
else
	error=$(head -n1 "$result_file")
	error=${error#agent-hibernate: }
	message="$action ✗ ${error:-failed}"
	duration=6000
fi

display=(display-message)
[ -n "$client" ] && display+=(-c "$client")
tmux "${display[@]}" -d "$duration" "$message" 2>/dev/null || true
exit 0
