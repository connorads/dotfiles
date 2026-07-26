#!/bin/sh
# agent-pretooluse.sh — Codex `PreToolUse` hook adapter: map the question-card
# tool to `blocked`, every other tool to `working`.
#
# Codex's question card is the `request_user_input` tool. Unlike Claude's
# `AskUserQuestion` (which also fires `PermissionRequest`), Codex fires only
# `PreToolUse`/`PostToolUse` for it and **no** `PermissionRequest` — so without
# this adapter a pane awaiting your answer sits at `working` (peach), never
# `blocked` (red). This inspects the tool name and forwards the right verb.
#
# Mirrors agent-stop.sh: drain stdin once, jq-inspect the payload, then re-pipe
# the saved payload into agent-state.sh so its journal capture stays intact.
#
# Fail-open to `working` if jq is missing or the payload won't parse — never
# worse than the previous unconditional-`working` wiring.

set -u

# agent-state.sh lives beside this script; resolve off $0, the same idiom as
# agent-stop.sh.
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Capture the payload rather than streaming it straight into jq: agent-state.sh
# journals hook payloads (agent-journal.sh), so PreToolUse's is re-piped through.
payload=$(cat 2>/dev/null) || payload=

tool=
if command -v jq >/dev/null 2>&1; then
	tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null) || tool=
fi

case $tool in
request_user_input) state=blocked ;;
*) state=working ;;
esac

printf '%s' "$payload" | sh "$SELF_DIR/agent-state.sh" "$state" "${1:-codex}"
