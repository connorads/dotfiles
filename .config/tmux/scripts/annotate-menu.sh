#!/usr/bin/env bash
# annotate-menu.sh — the menu behind a click on the annotate pill.
#
# Rows match the state, the same rule vox-menu.sh follows, because a Discard row
# with no draft to discard is exactly the drift the one-lib rule exists to
# prevent:
#
#   SPOOLED    Draft and send… · Drop newest · Clear spool (confirmed) · Stash…
#   DRAFTING   Edit draft…     · Discard draft (confirmed) · Clear spool (confirmed) · Stash…
#   IDLE       Stash…
#
# It exists because the pill was the one status pill whose click ran an action
# rather than opening a chooser, and that action was the most committal one:
# `annotate send` delivers into a pane. The pill could say something was waiting
# and offer no way to deal with it except commit it. Drop/clear/discard had no
# tmux route at all.
#
# Two rows are confirmed, and only these two, because only these two lose
# writing: `clear` drops stashed excerpts, and `draft --discard` is
# unrecoverable — `annotate undo` restores a draft a *send* delivered, so it
# cannot bring back a discarded one. Sending only spends a paste.
#
# `undo` is deliberately NOT a row. After a send the spool and draft are both
# empty, so the state is IDLE and the pill is hidden — this menu is unreachable
# at the exact moment undo is wanted. It lives in the `prefix + T` Tools
# launcher instead, which is reachable in every state.
#
# Drop-newest is offered only while SPOOLED: once a draft exists the excerpts
# are rendered into it, and dropping one behind the draft's back reads as a
# no-op.
#
#   annotate-menu.sh CLIENT MOUSE_X MOUSE_Y [CWD]
#
# CWD is where the draft float opens, passed by the binding as
# #{pane_current_path} (run-shell format-expands its command string). It falls
# back to a live query, so calling this by hand or in a test needs no argument.
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

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# The tmux server's PATH does not carry ~/.local/bin, so resolve rather than
# assume the menu's shell inherited it.
ANNOTATE_BIN=${ANNOTATE_BIN:-$HOME/.local/bin/annotate}
FLT=${FLT:-$HOME/.local/bin/flt}
PICK="$SELF_DIR/annotate-pick.sh"
# shellcheck source=/dev/null
. "$SELF_DIR/annotate-lib.sh"

client=${1:-}
mx=${2:-C}
my=${3:-C}
cwd=${4:-}
[ -n "$cwd" ] || cwd=$(tmux display-message -p '#{pane_current_path}' 2>/dev/null || true)
[ -n "$cwd" ] || cwd=$HOME

# One read of the store for the whole menu — annotate_pill is the lib's
# sanctioned single-read accessor, so this never reaches for its underscore
# locals and never spawns the CLI twice.
read -r state spool <<<"$(annotate_pill)"

title=" annotate: $(printf '%s' "$state" | tr '[:upper:]' '[:lower:]') "

# `annotate send` renders the spool into a draft, opens $EDITOR and delivers on
# save+quit — the same command whether a draft already exists or not. Only the
# label differs, because "Draft and send…" describes nothing when the draft is
# already written.
draft_row="run-shell '\"$FLT\" -c \"$cwd\" big \"$ANNOTATE_BIN\" send'"

menu=(display-menu -O)
[ -n "$client" ] && menu+=(-c "$client")
menu+=(-x "$mx" -y "$my" -T "$title")

if [ "$state" = SPOOLED ]; then
	menu+=(
		"Draft and send…" s "$draft_row"
		"Drop the newest excerpt" n "run-shell '\"$ANNOTATE_BIN\" drop last'"
		""
	)
elif [ "$state" = DRAFTING ]; then
	menu+=(
		"Edit the draft…" e "$draft_row"
		""
		"Discard the draft" d "confirm-before -p 'discard the draft? (y/n)' \"run-shell '\\\"$ANNOTATE_BIN\\\" draft --discard'\""
	)
fi

if [ "$state" != IDLE ]; then
	menu+=(
		"Clear the spool ($spool)" c "confirm-before -p 'clear the spool? (y/n)' \"run-shell '\\\"$ANNOTATE_BIN\\\" clear'\""
		""
	)
fi

# The picker needs the origin pane and resolves it by querying, so it is passed
# no argument here for the same reason the `prefix + Alt+Shift+E` binding passes
# none: a popup does not change the active pane.
menu+=("Stash from transcript…" t "display-popup -E -h 80% -w 85% '$PICK'")

tmux "${menu[@]}"
