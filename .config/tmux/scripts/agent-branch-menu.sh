#!/usr/bin/env bash
# agent-branch-menu.sh: dispatch prefix + Alt+b to the focused agent's branch
# menu. Claude and Codex have different fork CLIs, so keep the menus separate
# after resolving the foreground process.
set -euo pipefail

# shellcheck source=lib/claude-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/claude-session.sh"

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_path="${3:-}"
pane_pid="${4:-}"

script_dir="$(dirname "${BASH_SOURCE[0]}")"

if [ -n "$(claude_foreground_pid_for_tty "$pane_tty" "claude" "$pane_pid")" ]; then
	exec "$script_dir/claude-branch-menu.sh" "$pane_id" "$pane_tty" "$pane_path" "$pane_pid"
fi

if [ -n "$(claude_foreground_pid_for_tty "$pane_tty" "codex" "$pane_pid")" ]; then
	exec "$script_dir/codex-branch-menu.sh" "$pane_id" "$pane_tty" "$pane_path" "$pane_pid"
fi

tmux display-message "No Claude or Codex in this pane"
