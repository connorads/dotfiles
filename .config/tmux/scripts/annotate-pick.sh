#!/usr/bin/env bash
# annotate-pick.sh — the transcript picker. fzf over the messages in a Claude
# pane's session transcript, stashing whichever you choose.
#
#   annotate-pick.sh <pane-id>
#
# This exists because the screen is a lossy render of the transcript. A Claude
# pane runs on the alternate screen, so tmux holds no scrollback for it, and
# Claude also elides on screen (`… +42 lines`) — the untruncated text only
# exists in the session JSONL.
#
#   enter    stash the message
#   tab      add to the selection; enter stashes all of it
#   ctrl-/   toggle the preview
#
# A popup rather than a float, unlike the draft: this is a quick transaction,
# and it needs the origin pane. Actions run after fzf exits, never inside
# `--bind execute()`, so they own the popup's real tty.
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

set -uo pipefail

PANE=${1:-}

# The tmux server's PATH does not carry ~/.local/bin, so resolve rather than
# assume the popup shell inherited it.
ANNOTATE_BIN=${ANNOTATE_BIN:-$HOME/.local/bin/annotate}

if [ -z "$PANE" ]; then
	printf 'annotate-pick: needs a pane id\n' >&2
	sleep 1.2
	exit 2
fi

if ! command -v fzf >/dev/null 2>&1; then
	printf 'annotate-pick: fzf is not installed\n'
	sleep 1.2
	exit 0
fi

# One row per message: uuid in field 1, hidden by --with-nth=2.., so the
# selection carries the id without showing it.
rows=$("$ANNOTATE_BIN" entries --pane "$PANE" 2>&1) || {
	printf '%s\n' "$rows"
	sleep 1.5
	exit 0
}

if [ -z "$rows" ]; then
	printf 'No transcript messages for %s.\n' "$PANE"
	sleep 1.2
	exit 0
fi

out=$(printf '%s\n' "$rows" | fzf \
	--reverse --multi --info=hidden \
	--delimiter=$'\t' --with-nth=2.. \
	--prompt='message › ' \
	--header='enter: stash · tab: select · ctrl-/: toggle preview' \
	--preview "'$ANNOTATE_BIN' entries --pane '$PANE' --json | jq -r --arg u {1} '.[] | select(.uuid==\$u) | .text'" \
	--preview-window='right,60%,wrap' \
	--bind 'ctrl-/:toggle-preview') || exit 0

mapfile -t lines <<<"$out"
uuids=()
for line in "${lines[@]}"; do
	[ -n "$line" ] || continue
	uuids+=("${line%%$'\t'*}")
done
((${#uuids[@]})) || exit 0

stashed=0
for uuid in "${uuids[@]}"; do
	if "$ANNOTATE_BIN" stash --source transcript --pane "$PANE" --entry "$uuid" >/dev/null 2>&1; then
		stashed=$((stashed + 1))
	fi
done

tmux display-message "annotate: stashed $stashed from $PANE"
exit 0
