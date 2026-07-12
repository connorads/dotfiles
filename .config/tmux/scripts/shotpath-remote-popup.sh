#!/usr/bin/env bash
# shotpath-remote-popup.sh: upload a clipboard PNG/GIF (prefix + Alt+I).
# A popup is justified here — the fzf host picker and ssh prompts need a tty.
# On success the remote path is pasted into the origin pane (bracketed paste;
# clipboard already holds it as the fallback) and the popup exits 0 so
# display-popup -E auto-closes, with the result reported on the status line.
# Failure pauses only when there is error text to read; a plain fzf cancel
# (Esc, no stderr) exits immediately — no pause-tax on backing out.
set -uo pipefail

# shotpath is a dual-mode zsh function exposed via ~/.local/bin; the tmux
# server's PATH may not carry that dir.
PATH="$HOME/.local/bin:$PATH"

# Origin pane, resolved in-script: display-popup does not reliably expand
# #{pane_id} in its command, and the popup itself doesn't change the active
# pane, so asking tmux now still names the pane the key was pressed in.
pane_id=$(tmux display-message -p '#{pane_id}' 2>/dev/null || true)

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

# Keep SSH/Tailscale authentication instructions visible while retaining stderr
# to distinguish an error from a silent fzf cancellation.
if path=$(SHOTPATH_PICKER=1 SHOTPATH_PROGRESS=1 shotpath --remote 2> >(tee "$stderr_file" >&2)); then
	if paste_into_pane "$pane_id" "$path"; then
		tmux display-message -d 3000 "shotpath ✓ pasted $path"
	else
		tmux display-message -d 3000 "shotpath ✓ copied $path"
	fi
	exit 0
fi

if [ -s "$stderr_file" ]; then
	printf '\nPress any key…' >&2
	read -rsn1 || true
fi
exit 0
