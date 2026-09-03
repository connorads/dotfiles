#!/usr/bin/env bash
# copy-pane-contents.sh: copy a pane's retained history and current screen as
# logical plain-text lines to the tmux buffer and the client clipboard.
#
# Usage: copy-pane-contents.sh <pane_id>
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

set -euo pipefail

pane_id="${1:?pane_id required}"
tmp="$(mktemp "${TMPDIR:-/tmp}/copy-pane-contents.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# capture-pane pads the current screen to its full height. Keep internal blank
# lines, but remove that trailing terminal padding from the copied text.
if ! tmux capture-pane -p -J -S - -t "$pane_id" |
	awk '{ lines[NR] = $0; if ($0 !~ /^[[:space:]]*$/) last = NR } END { for (i = 1; i <= last; i++) print lines[i] }' >"$tmp"; then
	tmux display-message -d 4000 -l -- "Copy $pane_id failed · pane unavailable"
	exit 1
fi

if [[ ! -s "$tmp" ]]; then
	tmux display-message -d 2000 -l -- "Nothing to copy · $pane_id is empty"
	exit 0
fi

if ! tmux load-buffer -w "$tmp" ||
	! "$(dirname "${BASH_SOURCE[0]}")/osc52-copy-to-client.sh" <"$tmp"; then
	tmux display-message -d 4000 -l -- "Copy $pane_id failed · clipboard unavailable"
	exit 1
fi

lines="$(awk 'END { print NR + 0 }' "$tmp")"
tmux display-message -l -- "Copied $pane_id · $lines lines"
