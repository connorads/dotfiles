#!/usr/bin/env bash
# resurrect-codex-launch.sh: runs INSIDE a restored tmux pane to resume the
# right Codex conversation. Identity is exact: $TMUX_PANE names this pane
# unambiguously, so it reads its own live pane key and looks up the matching
# session id in session_ids.json. This deliberately replaces resolving the
# session in the eval-time strategy, where the active-pane read is a race (and
# plain wrong with no client attached). Flags to preserve arrive as "$@".
#
# Degrades to `codex resume --last "$@"` whenever exact identity can't be
# resolved (missing jq / session file / $TMUX_PANE, or an ambiguous cwd) - it
# never guesses a wrong resume, which was the multi-pane-same-cwd bug this
# replaces.

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

SESSION_FILE="$HOME/.local/share/tmux/resurrect/session_ids.json"

resume=""

if command -v jq &>/dev/null && [ -f "$SESSION_FILE" ] && [ -n "${TMUX_PANE:-}" ]; then
	pane_key=$(tmux display-message -pt "$TMUX_PANE" '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
	if [ -n "$pane_key" ]; then
		resume=$(jq -r --arg k "$pane_key" '.panes[$k].codex // empty' "$SESSION_FILE" 2>/dev/null || true)
	fi

	# Safe cwd fallback on exact-key miss: use it only when EXACTLY one recorded
	# pane owns this cwd. 0 or >1 -> do not guess (the regression guard).
	if [ -z "$resume" ]; then
		local_matches=$(jq -r --arg dir "$PWD" '[.panes[] | select(.dir == $dir and (.codex // "") != "")] | length' "$SESSION_FILE" 2>/dev/null || echo 0)
		if [ "$local_matches" = "1" ]; then
			resume=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.codex // "") != "")) | .codex' "$SESSION_FILE" 2>/dev/null || true)
		fi
	fi
fi

if [ -n "$resume" ]; then
	exec codex resume "$resume" "$@"
fi
exec codex resume --last "$@"
