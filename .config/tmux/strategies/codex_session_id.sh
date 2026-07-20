#!/usr/bin/env bash
# codex_session_id.sh: tmux-resurrect strategy for Codex.
# Emits a launcher invocation; the launcher resolves the session id INSIDE the
# restored pane (exact identity via $TMUX_PANE). Session resolution is
# deliberately NOT done here: at eval time the active-pane read is a race, and
# plain wrong with no client attached. This only carries the saved flags (e.g.
# --dangerously-bypass-approvals-and-sandbox) across, since they are not
# persisted in the session. Falls back to the bare saved command when argv0 is
# not codex.

SAVED_COMMAND="$1"
LAUNCHER="$HOME/.config/tmux/scripts/resurrect-codex-launch.sh"

# shellcheck source=../scripts/lib/resurrect-argv.sh disable=SC1091
[ -f "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh" ] &&
	. "$HOME/.config/tmux/scripts/lib/resurrect-argv.sh"

main() {
	local flags=""
	if command -v resurrect_argv_codex_flags &>/dev/null; then
		flags=$(resurrect_argv_codex_flags "$SAVED_COMMAND") || {
			echo "$SAVED_COMMAND"
			return
		}
	fi
	echo "$LAUNCHER${flags:+ $flags}"
}
main
