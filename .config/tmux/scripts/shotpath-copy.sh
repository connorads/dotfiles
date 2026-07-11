#!/usr/bin/env bash
# shotpath-copy.sh: fire-and-forget local shotpath (prefix + Alt+i), invoked via
# run-shell -b — no popup, no interactive shell. shotpath saves the clipboard
# image and puts the full path on the clipboard; this wrapper only surfaces
# success/failure on the status line (basename is enough signal — the full path
# is already on the clipboard). Always exits 0 so run-shell doesn't stomp the
# message with its own "returned N" output.
set -uo pipefail

# shotpath is a dual-mode zsh function exposed via ~/.local/bin; the tmux
# server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

stderr_file=$(mktemp)
trap 'rm -f "$stderr_file"' EXIT

if path=$(shotpath 2>"$stderr_file"); then
	tmux display-message -d 2000 "shotpath ✓ copied $(basename "$path")"
else
	err=$(head -n1 "$stderr_file")
	err=${err#shotpath: }
	tmux display-message -d 4000 "shotpath ✗ ${err:-failed}"
fi
exit 0
