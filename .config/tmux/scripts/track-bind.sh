#!/bin/sh
# track-bind: append keybinding usage to JSONL log (best-effort, async)
# Args: key name session window pane path host
set -e
DIR="$HOME/.local/state/tmux"
FILE="$DIR/usage.jsonl"
mkdir -p "$DIR" 2>/dev/null || exit 0
printf '{"ts":"%s","key":"%s","name":"%s","session":"%s","window":"%s","pane":"%s","path":"%s","host":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" "$5" "$6" "$7" \
  >> "$FILE" 2>/dev/null || exit 0
