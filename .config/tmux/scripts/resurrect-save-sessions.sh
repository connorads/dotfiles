#!/usr/bin/env bash
# resurrect-save-sessions.sh: post-save hook for tmux-resurrect
# Discovers active Claude Code, Codex and OpenCode session IDs and writes a
# companion JSON file that strategy scripts read at restore time.

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

SAVE_FILE="$1"
RESURRECT_DIR="$(dirname "$SAVE_FILE")"
SESSION_FILE="$RESURRECT_DIR/session_ids.json"

# Shared pane -> agent PID -> live session-file resolver.
# shellcheck source=lib/agent-session.sh disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/agent-session.sh"

# Require jq
if ! command -v jq &>/dev/null; then
	exit 0
fi

declare -A CLAUDE_PANE_SESSIONS
declare -A CLAUDE_PANE_DIRS
declare -A CLAUDE_PANE_ENVS
declare -A CODEX_PANE_SESSIONS
declare -A CODEX_PANE_DIRS
declare -A OPENCODE_PANE_SESSIONS
declare -A OPENCODE_PANE_DIRS
declare -A OPENCODE_PANE_ENVS
declare -A OPENCODE_SESSIONS
declare -A OPENCODE_ENVS
declare -A OPENCODE_DIR_COUNTS
declare -A LIVE_AGENT_DIRS
found_sessions=0

# --- Claude Code session discovery ---
# Session files: ~/.claude/projects/<project-hash>/<uuid>.jsonl
# Project hash = directory path with / replaced by -
find_claude_session() {
	local dir="$1"
	local pane_pid="$2"
	local tty="$3"
	local session_id=""
	local claude_pid=""
	local config_dir=""

	claude_pid=$(agent_foreground_pid_for_tty "$tty" "claude" "$pane_pid")

	# A ccp pane's session lives under its profile config dir, not ~/.claude, so
	# resolve the account first and read the registry from there.
	if [ -n "$claude_pid" ]; then
		config_dir=$(claude_config_dir_for_pid "$claude_pid")
	fi

	# Claude Code writes the active session ID keyed by its process PID.
	if [ -n "$claude_pid" ]; then
		session_id=$(claude_session_meta_for_pid "$claude_pid" "$config_dir" |
			jq -r --arg dir "$dir" 'select((.cwd // $dir) == $dir) | .sessionId // empty' 2>/dev/null || true)
	fi

	# Fallback for older Claude versions — find .jsonl files the process has open.
	# Match either the default ~/.claude/projects/ or the profile's <dir>/projects/.
	if [ -z "$session_id" ] && [ -n "$claude_pid" ] && kill -0 "$claude_pid" 2>/dev/null; then
		local projects_re='\.claude/projects/'
		if [ -n "$config_dir" ]; then
			projects_re="${config_dir}/projects/"
		fi
		local lsof_bin
		lsof_bin=$(agent_lsof_command)
		[ -n "$lsof_bin" ] || lsof_bin=lsof
		session_id=$("$lsof_bin" -p "$claude_pid" 2>/dev/null |
			grep '\.jsonl$' |
			grep -F "$projects_re" |
			awk '{print $NF}' |
			head -1 |
			xargs -I{} basename {} .jsonl 2>/dev/null || true)
	fi

	echo "$session_id"
}

# --- Claude Code env capture ---
# A client pane runs under CLAUDE_CONFIG_DIR=~/.claude-profiles/code/<name>,
# invisible in argv, so fidelity restore needs this one env var recorded at save
# time - without it a restored client pane silently reverts to the personal
# account (a cross-billing risk). Delegates to the shared
# claude_config_dir_for_pid (env introspection, secret-safe by construction).
find_claude_env() {
	local pane_pid="$1"
	local tty="$2"
	local claude_pid=""

	claude_pid=$(agent_foreground_pid_for_tty "$tty" "claude" "$pane_pid")
	[ -n "$claude_pid" ] || return 0

	claude_config_dir_for_pid "$claude_pid"
}

# --- Codex session discovery ---
# Session files: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
find_codex_session() {
	local dir="$1"
	local pane_pid="$2"
	local tty="$3"
	local session_id=""
	local codex_pid=""

	codex_pid=$(agent_foreground_pid_for_tty "$tty" "codex" "$pane_pid")
	if [ -z "$codex_pid" ]; then
		echo ""
		return
	fi

	session_id=$(codex_session_id_for_pid "$codex_pid" "$dir")

	echo "$session_id"
}

# --- OpenCode session discovery ---
# Current OpenCode persists sessions in ~/.local/share/opencode/opencode.db.
# There is no passive active-session marker, so cwd/latest restore is used only
# when a single live OpenCode pane owns that cwd.
find_opencode_session() {
	local dir="$1"
	local allow_latest="${2:-0}"
	local session_id=""

	if [ "$allow_latest" = "1" ] && command -v sqlite3 &>/dev/null; then
		local db="$HOME/.local/share/opencode/opencode.db"
		if [ -f "$db" ]; then
			session_id=$(sqlite3 -readonly "$db" \
				"select id from session where directory = $(sql_quote "$dir") order by time_updated desc limit 1;" 2>/dev/null || true)
		fi
	fi

	echo "$session_id"
}

sql_quote() {
	local value="${1//\'/\'\'}"
	printf "'%s'" "$value"
}

# --- OpenCode env capture ---
# ocy's yolo mode lives in OPENCODE_CONFIG_CONTENT, invisible in argv, so
# fidelity restore needs this one env var recorded at save time.
# SECURITY: /proc environ and `ps -E` expose the process's FULL environment
# including real secrets - extract only this var, never persist anything else.
find_opencode_env() {
	local pane_pid="$1"
	local tty="$2"
	local opencode_pid=""

	opencode_pid=$(agent_foreground_pid_for_tty "$tty" "opencode" "$pane_pid")
	[ -n "$opencode_pid" ] || return 0

	# Linux: null-delimited environ file (RESURRECT_PROC_ROOT overrides for tests).
	local environ="${RESURRECT_PROC_ROOT:-/proc}/$opencode_pid/environ"
	if [ -r "$environ" ]; then
		tr '\0' '\n' <"$environ" 2>/dev/null |
			grep -m1 '^OPENCODE_CONFIG_CONTENT=' | cut -d= -f2- || true
		return 0
	fi

	# macOS: ps -E appends the env as space-separated tokens. Space-containing
	# values are unsupported here (the ocy JSON contains none).
	ps -E -o command= -p "$opencode_pid" 2>/dev/null |
		tr ' ' '\n' |
		grep -m1 '^OPENCODE_CONFIG_CONTENT=' | cut -d= -f2- || true
}

# --- Get pane PIDs from tmux (still running at hook time) ---
# Returns: session:window.pane<TAB>pid<TAB>command<TAB>cwd<TAB>tty
get_live_panes() {
	tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}	#{pane_pid}	#{pane_current_command}	#{pane_current_path}	#{pane_tty}' 2>/dev/null || true
}

# --- Parse save file for panes running claude, codex or opencode ---
# Save file pane format (tab-delimited):
# pane<TAB>session<TAB>window<TAB>win_active<TAB>:flags<TAB>pane_idx<TAB>:title<TAB>:dir<TAB>pane_active<TAB>pane_cmd<TAB>:full_cmd
# But PID is not in the save file — we use live tmux panes instead.

# Read live pane data and match against agent processes.
live_panes=$(get_live_panes)

# OpenCode has no live active-session marker, so its cwd/latest restore is
# gated on a single live pane owning the cwd. Claude/Codex resolve exactly at
# restore time (see the launchers) and need no save-time disambiguation.
while IFS=$'\t' read -r pane_key pid cmd dir tty; do
	[ -n "${pane_key:-}" ] || continue
	case "$cmd" in
	opencode)
		OPENCODE_DIR_COUNTS["$dir"]=$((${OPENCODE_DIR_COUNTS["$dir"]:-0} + 1))
		;;
	esac
done <<<"$live_panes"

while IFS=$'\t' read -r pane_key pid cmd dir tty; do
	[ -n "${pane_key:-}" ] || continue
	# Every live agent pane, resolved or not — the guard for carrying an
	# unconfirmed entry through this save (see the carried map below).
	case "$cmd" in
	claude | codex | opencode)
		LIVE_AGENT_DIRS["$pane_key"]="$dir"
		;;
	esac
	case "$cmd" in
	claude)
		sid=$(find_claude_session "$dir" "$pid" "$tty")
		if [ -n "$sid" ]; then
			found_sessions=1
			CLAUDE_PANE_SESSIONS["$pane_key"]="$sid"
			CLAUDE_PANE_DIRS["$pane_key"]="$dir"
			env_val=$(find_claude_env "$pid" "$tty")
			if [ -n "$env_val" ]; then
				CLAUDE_PANE_ENVS["$pane_key"]="$env_val"
			fi
		fi
		;;
	codex)
		sid=$(find_codex_session "$dir" "$pid" "$tty")
		if [ -n "$sid" ]; then
			found_sessions=1
			CODEX_PANE_SESSIONS["$pane_key"]="$sid"
			CODEX_PANE_DIRS["$pane_key"]="$dir"
		fi
		;;
	opencode)
		allow_latest=0
		if [ "${OPENCODE_DIR_COUNTS["$dir"]:-0}" -eq 1 ]; then
			allow_latest=1
		fi
		sid=$(find_opencode_session "$dir" "$allow_latest")
		if [ -n "$sid" ]; then
			found_sessions=1
			OPENCODE_PANE_SESSIONS["$pane_key"]="$sid"
			OPENCODE_PANE_DIRS["$pane_key"]="$dir"
			OPENCODE_SESSIONS["$dir"]="$sid"
			env_val=$(find_opencode_env "$pid" "$tty")
			if [ -n "$env_val" ]; then
				OPENCODE_PANE_ENVS["$pane_key"]="$env_val"
				OPENCODE_ENVS["$dir"]="$env_val"
			fi
		fi
		;;
	esac
done <<<"$live_panes"

# --- Write companion JSON ---
# Collect all unique directories (OpenCode only - the per-dir map is its
# single-pane cwd fallback; Claude/Codex resolve by pane key at restore time).
declare -A ALL_DIRS
for dir in "${!OPENCODE_SESSIONS[@]}"; do ALL_DIRS["$dir"]=1; done

# --- Carried entries: a save that can't confirm an entry must not destroy it ---
# A pane can be a live agent yet resolve to nothing (agent still starting, a
# trust prompt, a transient ps miss). Rewriting the map from this save's
# findings alone would drop that pane's session id and account, so an old entry
# is carried when its pane key still holds a live agent pane in the *same* cwd.
# Keys that are dead or whose slot moved on are pruned, keeping the file
# self-cleaning and this save idempotent.
live_json=$(
	for pane_key in "${!LIVE_AGENT_DIRS[@]}"; do
		jq -n --arg k "$pane_key" --arg v "${LIVE_AGENT_DIRS[$pane_key]}" '{($k): $v}'
	done | jq -cs 'add // {}'
)
carried='{}'
if [ -f "$SESSION_FILE" ]; then
	# A missing, malformed or v1 file carries nothing and never fails the save.
	carried=$(jq -c --argjson live "$live_json" '
		(.panes // {}) | with_entries(
			select(($live[.key] // null) != null and .value.dir == $live[.key]))
	' "$SESSION_FILE" 2>/dev/null || echo '{}')
	[ -n "$carried" ] || carried='{}'
fi
carried_count=$(jq -n --argjson carried "$carried" '$carried | length' 2>/dev/null || echo 0)

if [ "$found_sessions" -eq 0 ] && [ "$carried_count" -eq 0 ]; then
	# Nothing recorded and nothing to carry — remove stale file if present
	rm -f "$SESSION_FILE"
	exit 0
fi

# Build JSON with jq, seeded with the carried entries so this save's freshly
# resolved ones overlay them.
json=$(jq -n --argjson carried "$carried" '{version: 2, panes: $carried}')
for pane_key in "${!CLAUDE_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${CLAUDE_PANE_DIRS[$pane_key]}" --arg sid "${CLAUDE_PANE_SESSIONS[$pane_key]}" '{dir: $dir, claude: $sid}')
	if [ -n "${CLAUDE_PANE_ENVS[$pane_key]:-}" ]; then
		entry=$(echo "$entry" | jq --arg env "${CLAUDE_PANE_ENVS[$pane_key]}" '. + {claudeConfigDir: $env}')
	fi
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = $entry')
done
for pane_key in "${!CODEX_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${CODEX_PANE_DIRS[$pane_key]}" --arg sid "${CODEX_PANE_SESSIONS[$pane_key]}" '{dir: $dir, codex: $sid}')
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = (.panes[$pane_key] // {}) + $entry')
done
for pane_key in "${!OPENCODE_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${OPENCODE_PANE_DIRS[$pane_key]}" --arg sid "${OPENCODE_PANE_SESSIONS[$pane_key]}" '{dir: $dir, opencode: $sid}')
	if [ -n "${OPENCODE_PANE_ENVS[$pane_key]:-}" ]; then
		entry=$(echo "$entry" | jq --arg env "${OPENCODE_PANE_ENVS[$pane_key]}" '. + {opencodeEnv: $env}')
	fi
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = (.panes[$pane_key] // {}) + $entry')
done

for dir in "${!ALL_DIRS[@]}"; do
	entry="{}"
	if [ -n "${OPENCODE_SESSIONS[$dir]:-}" ]; then
		entry=$(echo "$entry" | jq --arg sid "${OPENCODE_SESSIONS[$dir]}" '. + {opencode: $sid}')
		if [ -n "${OPENCODE_ENVS[$dir]:-}" ]; then
			entry=$(echo "$entry" | jq --arg env "${OPENCODE_ENVS[$dir]}" '. + {opencodeEnv: $env}')
		fi
	fi
	json=$(echo "$json" | jq --arg dir "$dir" --argjson entry "$entry" '. + {($dir): $entry}')
done

# Write via a sibling temp file. A direct `>"$SESSION_FILE"` truncates the file
# before jq runs, so a jq failure destroys the session index instead of leaving
# the previous save intact. Same directory keeps the rename atomic.
tmp_file="$SESSION_FILE.tmp.$$"
if ! printf '%s\n' "$json" | jq '.' >"$tmp_file"; then
	rm -f "$tmp_file"
	printf '%s: refusing to overwrite %s with malformed JSON\n' \
		"${0##*/}" "$SESSION_FILE" >&2
	exit 1
fi
mv -f "$tmp_file" "$SESSION_FILE"
