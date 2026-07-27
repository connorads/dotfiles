#!/usr/bin/env bash
# shotpath-remote-popup.sh: upload a clipboard PNG/GIF (prefix + Alt+I).
# A popup is justified here — the fzf host picker and ssh prompts need a tty.
# On success the remote path is pasted into the origin pane (bracketed paste;
# clipboard already holds it as the fallback) and the popup exits 0 so
# display-popup -E auto-closes, with the result reported on the status line.
# Failure pauses only when there is error text to read; a plain fzf cancel
# (Esc, no stderr) exits immediately — no pause-tax on backing out.
# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

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
