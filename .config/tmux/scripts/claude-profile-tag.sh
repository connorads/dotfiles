#!/bin/sh
# claude-profile-tag: tag the current tmux pane with the active Claude profile
# label so the pane border shows the ccp account even when the statusline is
# occluded (plan mode, full-screen output, scrollback). Bare = set from
# $CLAUDE_CONFIG_DIR; `clear` = unset. $CLAUDE_PROFILE_PANE overrides $TMUX_PANE.
#
# Wired as a Claude SessionStart/SessionEnd hook (see ~/.claude/settings.json):
# it runs inside the claude process, so $CLAUDE_CONFIG_DIR is the real profile
# regardless of fresh launch / -r resume / fork / resurrect restore / teleport,
# and $TMUX_PANE is inherited from the pane. Quiet no-op outside tmux.
# shellcheck source=/dev/null
. "$HOME/.claude/hooks/profile-label.sh"

verb="${1:-set}"
pane=${CLAUDE_PROFILE_PANE:-${TMUX_PANE:-}}
[ -n "$pane" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0
tmux display-message -p -t "$pane" '#{window_id}' >/dev/null 2>&1 || exit 0

case "$verb" in
clear) tmux set-option -pu -t "$pane" @claude_profile 2>/dev/null || true ;;
*) tmux set-option -p -t "$pane" @claude_profile "$(claude_profile_label)" 2>/dev/null || true ;;
esac
