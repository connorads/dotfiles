#!/bin/sh
# agent-stop.sh — Claude `Stop` hook adapter: keep the dot peach while
# background work drains, only go blue once it's genuinely done.
#
# Claude emits the Stop hook at turn-end *unconditionally*, even when a
# background dynamic workflow or backgrounded subagent is still running (the
# "Waiting for N … to finish" UI) — the payload's `background_tasks` array
# carries the in-flight registry so a hook can tell "session is done" from
# "session is paused waiting for background work to wake it". A completed task
# later injects a <task-notification> that drives a fresh turn → another Stop
# with the drained (empty) array.
#
# We count only finite, wake-me-later work — `workflow`, `subagent`, `shell` —
# and forward `working` while any remain, else `done`. Persistent watchers
# (`monitor`, `dream`) are excluded: their status stays running forever, so
# counting them would pin the dot at working permanently. The allowlist is a
# single jq select() so widening it is trivial.
#
# Degrades to `done` if jq is missing or the payload won't parse — never worse
# than the previous unconditional-done wiring.

set -u

# agent-state-lib.sh (stop_state) lives beside this script; resolve off $0, the
# same idiom as agent-state.sh.
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=agent-state-lib.sh disable=SC1091
. "$SELF_DIR/agent-state-lib.sh"

count=0
if command -v jq >/dev/null 2>&1; then
	count=$(jq -r '
		[ .background_tasks[]?
		  | select(.type == "workflow" or .type == "subagent" or .type == "shell") ]
		| length' 2>/dev/null) || count=0
fi

exec sh "$SELF_DIR/agent-state.sh" "$(stop_state "$count")" claude
