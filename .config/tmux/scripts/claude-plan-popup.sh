#!/usr/bin/env bash
# claude-plan-popup: view a live Claude Code plan in the current TTY.
# Usage: claude-plan-popup [<pane_id>]   (run from the prefix + T Tools launcher)
#        claude-plan-popup --preview <planFilePath> <pane>   (fzf preview helper)
#
# This is a supervision tool: "show what agent X is planning, from wherever I am,
# across accounts" — so *selection* is part of the job, not an error path. Plans
# are read from the agent journal (lib/claude-plan.sh), never scraped from live
# processes: the ExitPlanMode hook already records `.plan.planFilePath` (which
# encodes the account) per pane. Given $1 = the launching pane, a plan-bearing
# live pane renders straight away; otherwise an fzf picker lists every live
# agent's plan (account · name · title · age + a preview) to choose from.
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

SELF="$0"
SELF_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib/claude-plan.sh disable=SC1091
. "$SELF_DIR/lib/claude-plan.sh"

# --- Rendering ---

# render_file <file> — full-screen paged render of a plan file.
render_file() {
	if command -v glow >/dev/null 2>&1; then
		glow -p -s dark "$1"
	elif command -v bat >/dev/null 2>&1; then
		bat --style=plain --paging=always --language=markdown "$1"
	else
		less "$1"
	fi
}

# render_stdin_paged — full-screen paged render of markdown on stdin (the inline
# journal snapshot when a plan file is gone). glow -p pages when stdout is a TTY.
render_stdin_paged() {
	if command -v glow >/dev/null 2>&1; then
		glow -p -s dark
	elif command -v bat >/dev/null 2>&1; then
		bat --style=plain --paging=always --language=markdown
	else
		less
	fi
}

# render_preview [file] — non-paged render for the fzf preview (file arg, else
# stdin). No pager: a pager inside an fzf preview would hang. Precedent:
# cmd-palette.sh's render().
render_preview() {
	local width=${FZF_PREVIEW_COLUMNS:-${COLUMNS:-80}}
	if command -v glow >/dev/null 2>&1; then
		glow -s dark -w "$width" "${1:--}"
	elif command -v bat >/dev/null 2>&1; then
		bat --style=plain --color=always --language=markdown "${1:--}"
	else
		cat "${1:--}"
	fi
}

# show_for_pane PANE PLANFILE — render PANE's plan: the file when it still exists,
# else the inline journal snapshot (labelled as such). PLANFILE may be empty.
show_for_pane() {
	local pane="$1" pf="$2" text
	if [ -n "$pf" ] && [ -f "$pf" ]; then
		render_file "$pf"
		return 0
	fi
	text=$(claude_plan_inline_for_pane "$pane")
	if [ -z "$text" ]; then
		tmux display-message "No recorded plan for that pane"
		return 0
	fi
	printf '> Journal snapshot — the plan file is no longer on disk.\n\n%s\n' "$text" |
		render_stdin_paged
}

# --- fzf preview subcommand ---
# Invoked by the picker's --preview. Renders the plan head for one row: its
# planFilePath when present on disk, else the pane's inline journal snapshot.
if [ "${1:-}" = "--preview" ]; then
	pf=${2:-}
	pane=${3:-}
	if [ -n "$pf" ] && [ -f "$pf" ]; then
		render_preview "$pf"
	else
		claude_plan_inline_for_pane "$pane" | render_preview
	fi
	exit 0
fi

# --- Entrypoint ---
# $1 is the launching pane id (TMUX_TOOLS_PANE), e.g. %5; empty when invoked bare.

pane_id="${1:-}"

rows=$(claude_plan_live_rows)

if [ -z "$rows" ]; then
	if ! command -v jq >/dev/null 2>&1; then
		tmux display-message "Plan viewer needs jq (not found)"
	elif [ "${AGENT_JOURNAL_DISABLE:-0}" = 1 ]; then
		tmux display-message "Agent journal is disabled; no plans to show"
	else
		tmux display-message "No live Claude agent has a recorded plan"
	fi
	exit 0
fi

# Fast path: the launching pane has a recorded plan → render it, no list.
if [ -n "$pane_id" ]; then
	fast_row=$(printf '%s\n' "$rows" | awk -F '\t' -v p="$pane_id" '$1 == p { print; exit }')
	if [ -n "$fast_row" ]; then
		pf=$(printf '%s' "$fast_row" | cut -f7)
		show_for_pane "$pane_id" "$pf"
		exit 0
	fi
fi

# Picker: a non-claude / planless / bare launch chooses among live plans. A lone
# row auto-opens (no needless one-item list). fzf style mirrors agent-popup.sh:
# hidden pane (field 1) is the join key, with-nth=2.. shows account onward.
row_count=$(printf '%s\n' "$rows" | grep -c .)
if [ "$row_count" -eq 1 ]; then
	choice="$rows"
else
	choice=$(printf '%s\n' "$rows" | fzf \
		--ansi --reverse --no-multi --info=hidden \
		--delimiter='\t' --with-nth=2..6 \
		--prompt='plan › ' \
		--header='account · name · dir · title · age' \
		--preview "bash '$SELF' --preview {7} {1}" \
		--preview-window=right:60%:wrap) || exit 0
fi

[ -n "$choice" ] || exit 0
target=$(printf '%s' "$choice" | cut -f1)
pf=$(printf '%s' "$choice" | cut -f7)
[ -n "$target" ] || exit 0
show_for_pane "$target" "$pf"
