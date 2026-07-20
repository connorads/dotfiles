#!/usr/bin/env bash
# claude_session_id.sh: tmux-resurrect strategy for Claude Code.
# Emits a launcher invocation; the launcher resolves the session id INSIDE the
# restored pane (exact identity via $TMUX_PANE). Session resolution is
# deliberately NOT done here: at eval time the active-pane read is a race, and
# plain wrong with no client attached (every pane collapses onto one). This
# only carries the saved flags (permission mode, system-prompt append, model,
# ...) across, since none of them are persisted in the session. Falls back to
# the bare saved command when argv0 is not claude.

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
