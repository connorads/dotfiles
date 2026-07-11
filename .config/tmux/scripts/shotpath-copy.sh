#!/usr/bin/env bash
# shotpath-copy.sh: fire-and-forget local shotpath (prefix + Alt+i), invoked via
# run-shell -b — no popup, no interactive shell. shotpath saves the clipboard
# PNG or GIF and puts the full path on the clipboard; this wrapper then pastes the
# path into the originating pane ($1 = pane id, expanded from #{pane_id} at
# press time) via a bracketed paste, and surfaces the outcome on the status
# line (basename is enough signal — the full path is in the pane/clipboard).
# No pane arg or a dead pane degrades to clipboard-only. Always exits 0 so
# run-shell doesn't stomp the message with its own "returned N" output.
set -uo pipefail

# shotpath is a dual-mode zsh function exposed via ~/.local/bin; the tmux
# server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

paste_into_pane() { # 0 if pasted, 1 otherwise (no pane / pane died mid-flight)
	local pane=$1 path=$2
	[ -n "$pane" ] || return 1
	tmux set-buffer -b shotpath -- "$path" || return 1
	# -p bracketed paste (only if the app requested it), -d drops the named
	# buffer afterwards so the buffer list stays clean.
	tmux paste-buffer -p -d -b shotpath -t "$pane" || return 1
}

stderr_file=$(mktemp)
trap 'rm -f "$stderr_file"' EXIT

if path=$(shotpath 2>"$stderr_file"); then
	if paste_into_pane "${1:-}" "$path"; then
		tmux display-message -d 2000 "shotpath ✓ pasted $(basename "$path")"
	else
		tmux display-message -d 2000 "shotpath ✓ copied $(basename "$path")"
	fi
else
	err=$(head -n1 "$stderr_file")
	err=${err#shotpath: }
	tmux display-message -d 4000 "shotpath ✗ ${err:-failed}"
fi
exit 0
