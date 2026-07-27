#!/usr/bin/env bash
# claude_session_id.sh: tmux-resurrect strategy for Claude Code.
# Emits a launcher invocation; the launcher resolves the session id INSIDE the
# restored pane (exact identity via $TMUX_PANE). Session resolution is
# deliberately NOT done here: at eval time the active-pane read is a race, and
# plain wrong with no client attached (every pane collapses onto one). This
# only carries the saved flags (permission mode, system-prompt append, model,
# ...) across, since none of them are persisted in the session. Falls back to
# the bare saved command when argv0 is not claude.

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

SAVED_COMMAND="$1"
LAUNCHER="$HOME/.config/tmux/scripts/resurrect-claude-launch.sh"

# shellcheck source=../scripts/lib/resurrect-argv.sh disable=SC1091
[ -f "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh" ] &&
	. "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh"

main() {
	local flags=""
	if command -v resurrect_argv_claude_flags &>/dev/null; then
		flags=$(resurrect_argv_claude_flags "$SAVED_COMMAND") || {
			echo "$SAVED_COMMAND"
			return
		}
	fi
	echo "$LAUNCHER${flags:+ $flags}"
}
main
