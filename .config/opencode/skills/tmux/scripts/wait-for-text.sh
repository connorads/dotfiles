#!/usr/bin/env bash
# Poll tmux pane for a text pattern with timeout
# Usage: wait-for-text.sh -t session:0.0 -p '^>>>' -T 15

set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") -t TARGET -p PATTERN [-T TIMEOUT] [-i INTERVAL]

Poll a tmux pane until a pattern appears in the output.

Options:
  -t TARGET    tmux target (session, session:window, or session:window.pane)
  -p PATTERN   grep pattern to wait for
  -T TIMEOUT   timeout in seconds (default: 30)
  -i INTERVAL  poll interval in seconds (default: 0.5)
  -h           show this help

Examples:
  $(basename "$0") -t mysession -p '^>>>'           # wait for Python prompt
  $(basename "$0") -t dev:0.0 -p 'gdb>' -T 60       # wait for gdb prompt
  $(basename "$0") -t repl -p 'error' -i 0.2        # quick polling for error
EOF
  exit 1
}

target=""
pattern=""
timeout=30
interval=0.5

while getopts "t:p:T:i:h" opt; do
  case $opt in
    t) target="$OPTARG" ;;
    p) pattern="$OPTARG" ;;
    T) timeout="$OPTARG" ;;
    i) interval="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

[[ -z "$target" ]] && { echo "Error: -t TARGET required" >&2; usage; }
[[ -z "$pattern" ]] && { echo "Error: -p PATTERN required" >&2; usage; }

# Check session exists
if ! tmux has-session -t "${target%%:*}" 2>/dev/null; then
  echo "Error: session '${target%%:*}' does not exist" >&2
  exit 1
fi

elapsed=0
while (( $(echo "$elapsed < $timeout" | bc -l) )); do
  output=$(tmux capture-pane -t "$target" -p 2>/dev/null || true)
  if echo "$output" | grep -qE "$pattern"; then
    echo "Pattern '$pattern' found after ${elapsed}s"
    exit 0
  fi
  sleep "$interval"
  elapsed=$(echo "$elapsed + $interval" | bc -l)
done

echo "Timeout (${timeout}s) waiting for pattern '$pattern'" >&2
echo "Last output:" >&2
tmux capture-pane -t "$target" -p | tail -20 >&2
exit 1
