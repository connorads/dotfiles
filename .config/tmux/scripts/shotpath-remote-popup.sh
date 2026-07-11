#!/usr/bin/env bash
# shotpath-remote-popup.sh: popup body for the remote case (prefix + Alt+I).
# A popup is justified here — the fzf host picker and ssh prompts need a tty.
# Success exits 0 so display-popup -E auto-closes, with the result reported on
# the status line. Failure pauses only when there is error text to read; a
# plain fzf cancel (Esc, no stderr) exits immediately — no pause-tax on
# backing out.
set -uo pipefail

# shotpath is a dual-mode zsh function exposed via ~/.local/bin; the tmux
# server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

stderr_file=$(mktemp)
trap 'rm -f "$stderr_file"' EXIT

if path=$(SHOTPATH_PICKER=1 shotpath --remote 2>"$stderr_file"); then
	tmux display-message -d 3000 "shotpath ✓ copied $path"
	exit 0
fi

if [ -s "$stderr_file" ]; then
	cat "$stderr_file" >&2
	printf '\nPress any key…' >&2
	read -rsn1 || true
fi
exit 0
