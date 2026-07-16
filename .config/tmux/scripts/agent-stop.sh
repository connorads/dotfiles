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
# We count only finite, wake-me-later work — `workflow`, `subagent` — and
# forward `working` while any remain, else `done`. Persistent watchers
# (`monitor`, `dream`) are excluded: their status stays running forever, so
# counting them would pin the dot at working permanently. The allowlist is a
# single jq select() so widening it is trivial.
#
# `shell` (backgrounded Bash) is excluded too, and the reason is an asymmetry
# in failure cost, not that shells never wake the session. A background shell
# is often a dev server that never exits: counting it pins the dot at working
# forever — no future hook fires and the sweep won't clear it (the agent is
# still foreground) — a silent permanent lie. The other direction self-heals:
# if a finite background build shows `done` early, its completion injects a
# task-notification, a fresh turn re-fires the hooks, and the dot corrects
# itself. Post-Stop the transcript is readable either way, so `done` is the
# truthful answer to the dot's real question ("should I look?").
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

# Capture the payload rather than streaming it straight into jq: agent-state.sh
# journals hook payloads (agent-journal.sh), so Stop's is re-piped through.
payload=$(cat 2>/dev/null) || payload=

count=0
if command -v jq >/dev/null 2>&1; then
	count=$(printf '%s' "$payload" | jq -r '
		[ .background_tasks[]?
		  | select(.type == "workflow" or .type == "subagent") ]
		| length' 2>/dev/null) || count=0
fi

printf '%s' "$payload" | sh "$SELF_DIR/agent-state.sh" "$(stop_state "$count")" claude
