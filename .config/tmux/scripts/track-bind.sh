#!/bin/sh
# track-bind: append keybinding usage to JSONL log (best-effort, async)
# Args: key name session window pane path host
set -e
DIR="$HOME/.local/state/tmux"
FILE="$DIR/usage.jsonl"
mkdir -p "$DIR" 2>/dev/null || exit 0
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if command -v jq >/dev/null 2>&1; then
	jq -cn \
		--arg ts "$ts" \
		--arg key "$1" \
		--arg name "$2" \
		--arg session "$3" \
		--arg window "$4" \
		--arg pane "$5" \
		--arg path "$6" \
		--arg host "$7" \
		'{ts:$ts,key:$key,name:$name,session:$session,window:$window,pane:$pane,path:$path,host:$host}' \
		>>"$FILE" 2>/dev/null || exit 0
else
	json_escape() {
		printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
	}
	printf '{"ts":"%s","key":"%s","name":"%s","session":"%s","window":"%s","pane":"%s","path":"%s","host":"%s"}\n' \
		"$(json_escape "$ts")" \
		"$(json_escape "$1")" \
		"$(json_escape "$2")" \
		"$(json_escape "$3")" \
		"$(json_escape "$4")" \
		"$(json_escape "$5")" \
		"$(json_escape "$6")" \
		"$(json_escape "$7")" \
		>>"$FILE" 2>/dev/null || exit 0
fi
