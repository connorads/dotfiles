#!/bin/sh
# agent-codex-session.sh: publish exact Codex thread identity to its tmux pane.

set -u

pane=${AGENT_STATE_PANE:-${TMUX_PANE:-}}
agent_state_sh=${AGENT_STATE_SH:-$HOME/.config/tmux/scripts/agent-state.sh}
[ -n "$pane" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
payload=$(cat)
event=${1:-}
[ -n "$event" ] || event=$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null)
rollout=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)
thread=""
if [ -n "$rollout" ] && [ -s "$rollout" ]; then
	thread=$(jq -r 'select(.type == "session_meta") | .payload.id // empty' "$rollout" 2>/dev/null | head -1)
fi
[ -n "$rollout" ] && tmux set-option -p -t "$pane" @codex_rollout_path "$rollout" 2>/dev/null || true
[ -n "$thread" ] && tmux set-option -p -t "$pane" @codex_thread_id "$thread" 2>/dev/null || true
case "$event" in
SessionStart)
	[ -n "$thread" ] && tmux set-option -p -t "$pane" @codex_started_thread "$thread" 2>/dev/null || true
	state=$(tmux show-options -pqv -t "$pane" @agent_state 2>/dev/null)
	[ "$state" = hibernated ] || AGENT_STATE_PANE="$pane" sh "$agent_state_sh" clear codex </dev/null || true
	;;
SessionEnd)
	[ -n "$thread" ] && tmux set-option -p -t "$pane" @codex_ended_thread "$thread" 2>/dev/null || true
	;;
esac
exit 0
