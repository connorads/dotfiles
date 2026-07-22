#!/usr/bin/env bash
# agent-teleport-menu.sh: dispatch prefix + Alt+t to agent-teleport for the
# focused pane's live Claude/Codex session. The outer mode resolves the agent
# (cheap, no popup when there is nothing to teleport) then opens a popup - the
# fzf host/delivery pickers and the dest prompt need a tty. The `run` mode is
# the popup body (shotpath-remote-popup.sh shape: ~/.local/bin on PATH, stderr
# teed so a real error pauses while a plain fzf cancel closes silently).
#
# Usage: agent-teleport-menu.sh <pane_id> <pane_tty> <pane_current_path> [pane_pid]
#        agent-teleport-menu.sh run <pane_id>
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "run" ]; then
	pane_id="${2:?pane_id required}"
	# agent-teleport is a dual-mode zsh function exposed via ~/.local/bin; the
	# tmux server's PATH may not carry that dir.
	PATH="$HOME/.local/bin:$PATH"

	stderr_file=$(mktemp)
	trap 'rm -f "$stderr_file"' EXIT

	agent-teleport --pane "$pane_id" --choose 2> >(tee "$stderr_file" >&2)
	rc=$?

	# 130 = fzf/prompt cancel: close silently, no pause-tax on backing out.
	[ "$rc" -eq 130 ] && exit 0
	# Success prints the summary (id mapping, dest, warnings) - hold the popup
	# open so it can be read; errors likewise have stderr worth reading.
	printf '\nPress any key…' >&2
	read -rsn1 || true
	exit 0
fi

# shellcheck source=lib/agent-session.sh disable=SC1091
. "$script_dir/lib/agent-session.sh"

pane_id="${1:?pane_id required}"
pane_tty="${2:-}"
pane_pid="${4:-}"

if [ -z "$(agent_foreground_pid_for_tty "$pane_tty" claude "$pane_pid")" ] &&
	[ -z "$(agent_foreground_pid_for_tty "$pane_tty" codex "$pane_pid")" ]; then
	tmux display-message "No Claude or Codex in this pane"
	exit 0
fi

exec tmux display-popup -E -w 80% -h 70% "$script_dir/agent-teleport-menu.sh run $pane_id"
