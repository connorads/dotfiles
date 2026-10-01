#!/usr/bin/env bash
# resurrect-claude-launch.sh: runs INSIDE a restored tmux pane to resume the
# right Claude Code conversation. Identity is exact: $TMUX_PANE names this pane
# unambiguously, so it reads its own live pane key and looks up the matching
# session id in session_ids.json. This deliberately replaces resolving the
# session in the eval-time strategy, where the active-pane read is a race (and
# plain wrong with no client attached - every pane collapses onto the last
# active one). Flags to preserve (permission mode, model, ...) arrive as "$@".
#
# Resolution order: the exact pane key in the map; then the id the saved argv
# resumed (RESURRECT_SAVED_CLAUDE_SID, set by the strategy), under the account
# whose projects/ tree holds its transcript; then the one map entry for this cwd.
# The map comes first because it tracks in-pane /resume and /new, while argv
# only records how the pane was launched. With none of those it never guesses a
# resume: `--continue` when this cwd held at most one claude pane in the last
# save, otherwise a fresh `claude "$@"`.
# CLAUDE_CONFIG_DIR (a ccp client account, invisible in argv) is restored so the
# pane keeps its billing account rather than reverting to the personal one.

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

RESURRECT_DIR="$HOME/.local/share/tmux/resurrect"
SESSION_FILE="$RESURRECT_DIR/session_ids.json"

# shellcheck source=lib/claude-account.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/claude-account.sh"

resume=""
config_dir=""
saved_sid="${RESURRECT_SAVED_CLAUDE_SID:-}"
unset RESURRECT_SAVED_CLAUDE_SID
have_map=0

if command -v jq &>/dev/null && [ -f "$SESSION_FILE" ] && [ -n "${TMUX_PANE:-}" ]; then
	have_map=1
	pane_key=$(tmux display-message -pt "$TMUX_PANE" '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null || true)
	if [ -n "$pane_key" ]; then
		resume=$(jq -r --arg k "$pane_key" '.panes[$k].claude // empty' "$SESSION_FILE" 2>/dev/null || true)
		config_dir=$(jq -r --arg k "$pane_key" '.panes[$k].claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null || true)
	fi
fi

# The transcript's location names its account; the default one needs no export.
if [ -z "$resume" ] && [ -n "$saved_sid" ]; then
	saved_dir=$(claude_config_dir_for_session "$saved_sid")
	if [ -n "$saved_dir" ]; then
		resume="$saved_sid"
		config_dir="$saved_dir"
		[ "$config_dir" != "$HOME/.claude" ] || config_dir=""
	fi
fi

# Safe cwd fallback on exact-key miss: use it only when EXACTLY one recorded
# pane owns this cwd. 0 or >1 -> do not guess (the regression guard).
if [ -z "$resume" ] && [ "$have_map" -eq 1 ]; then
	local_matches=$(jq -r --arg dir "$PWD" '[.panes[] | select(.dir == $dir and (.claude // "") != "")] | length' "$SESSION_FILE" 2>/dev/null || echo 0)
	if [ "$local_matches" = "1" ]; then
		resume=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.claude // "") != "")) | .claude' "$SESSION_FILE" 2>/dev/null || true)
		config_dir=$(jq -r --arg dir "$PWD" 'first(.panes[] | select(.dir == $dir and (.claude // "") != "")) | .claudeConfigDir // empty' "$SESSION_FILE" 2>/dev/null || true)
	fi
fi

if [ -n "$config_dir" ]; then
	export CLAUDE_CONFIG_DIR="$config_dir"
	# Refresh the restored profile's shared user config (settings + CLAUDE.md
	# memory) so a resumed ccp pane inherits the same statusLine/hooks/permissions
	# a fresh `ccp` launch materialises. Absolute path matches how the strategy
	# invokes this launcher; guarded like every other dep here (jq/session/pane),
	# and the helper itself fails open without jq/base.
	materialise="$HOME/.config/zsh/functions/claude-profile-materialise"
	[ -x "$materialise" ] && "$materialise" "$config_dir"
fi

if [ -n "$resume" ]; then
	exec claude "$@" --resume "$resume"
fi

# Several claude panes in this cwd would all --continue onto one conversation.
cwd_claude_panes=0
[ -f "$RESURRECT_DIR/last" ] && cwd_claude_panes=$(awk -F'\t' -v dir=":$PWD" '
	$1 == "pane" && $8 == dir {
		cmd = $11; sub(/^:/, "", cmd); split(cmd, argv, " "); n = split(argv[1], parts, "/")
		if (parts[n] == "claude") count++
	}
	END { print count + 0 }' "$RESURRECT_DIR/last")
if [ "$cwd_claude_panes" -gt 1 ]; then
	exec claude "$@"
fi
exec claude "$@" --continue
