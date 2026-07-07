#!/usr/bin/env sh
# tools-popup: fzf launcher for occasional tmux/system utilities (prefix + T).
#
# Reads `label<TAB>command` rows from ../tools.tsv, picks one with fzf, and runs
# it in this same popup TTY (the binding is `display-popup -E`, so we already own
# a real terminal). Loops back to the menu after each tool until Esc.
#
# Rationale: these tools (bulk tmux pane/window reshapes, conns, ports, pclose,
# bandwhich, tsp, tpm-clean) are
# each runnable from the shell and were individually near-zero-use as dedicated
# keybindings. One launcher keeps them discoverable without spending a key each.
# The TSV is shared on purpose: a future command-palette entry can list the same
# rows without duplicating the table.

set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
TSV="$DIR/tools.tsv"
[ -f "$TSV" ] || {
	echo "tools.tsv not found at $TSV"
	exit 1
}

while :; do
	sel=$(cut -f1 "$TSV" | fzf --reverse --prompt 'tools> ' \
		--header 'Tools · Enter runs · Esc quits') || exit 0
	[ -n "$sel" ] || exit 0

	cmd=$(awk -F'\t' -v l="$sel" '$1 == l { sub(/^[^\t]*\t/, ""); print; exit }' "$TSV")
	[ -n "$cmd" ] || continue

	clear
	zsh -ic "$cmd" || true
done
