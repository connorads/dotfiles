#!/usr/bin/env bash
# resurrect-save-sessions.sh: post-save hook for tmux-resurrect
# Discovers active Claude Code, Codex and OpenCode session IDs and writes a
# companion JSON file that strategy scripts read at restore time.

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

declare -A CLAUDE_SESSIONS
declare -A CLAUDE_PANE_SESSIONS
declare -A CLAUDE_PANE_DIRS
declare -A CLAUDE_DIR_COUNTS
declare -A CODEX_PANE_SESSIONS
declare -A CODEX_PANE_DIRS
declare -A OPENCODE_PANE_SESSIONS
declare -A OPENCODE_PANE_DIRS
declare -A OPENCODE_SESSIONS
declare -A OPENCODE_DIR_COUNTS
found_sessions=0

# --- Claude Code session discovery ---
# Session files: ~/.claude/projects/<project-hash>/<uuid>.jsonl
# Project hash = directory path with / replaced by -
find_claude_session() {
	local dir="$1"
	local pane_pid="$2"
	local tty="$3"
	local allow_latest="${4:-0}"
	local session_id=""
	local claude_pid=""

	claude_pid=$(agent_foreground_pid_for_tty "$tty" "claude" "$pane_pid")

	# Claude Code writes the active session ID keyed by its process PID.
	if [ -n "$claude_pid" ]; then
		session_id=$(claude_session_meta_for_pid "$claude_pid" |
			jq -r --arg dir "$dir" 'select((.cwd // $dir) == $dir) | .sessionId // empty' 2>/dev/null || true)
	fi

	# Fallback for older Claude versions — find .jsonl files the process has open.
	if [ -z "$session_id" ] && [ -n "$claude_pid" ] && kill -0 "$claude_pid" 2>/dev/null; then
		session_id=$(lsof -p "$claude_pid" 2>/dev/null |
			grep '\.jsonl$' |
			grep '\.claude/projects/' |
			awk '{print $NF}' |
			head -1 |
			xargs -I{} basename {} .jsonl 2>/dev/null || true)
	fi

	# Last resort for unambiguous cwd restores only. Duplicate-cwd panes must not
	# all inherit the same "latest" session.
	if [ -z "$session_id" ] && [ "$allow_latest" = "1" ]; then
		local project_hash
		project_hash="${dir//\//-}"
		local project_dir="$HOME/.claude/projects/$project_hash"
		if [ -d "$project_dir" ]; then
			local latest
			# shellcheck disable=SC2012  # mtime ordering is the fallback behaviour.
			latest=$(ls -t "$project_dir"/*.jsonl 2>/dev/null | head -1)
			if [ -n "$latest" ]; then
				session_id=$(basename "$latest" .jsonl)
			fi
		fi
	fi

	echo "$session_id"
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

while IFS=$'\t' read -r pane_key pid cmd dir tty; do
	[ -n "${pane_key:-}" ] || continue
	case "$cmd" in
	claude)
		CLAUDE_DIR_COUNTS["$dir"]=$((${CLAUDE_DIR_COUNTS["$dir"]:-0} + 1))
		;;
	opencode)
		OPENCODE_DIR_COUNTS["$dir"]=$((${OPENCODE_DIR_COUNTS["$dir"]:-0} + 1))
		;;
	esac
done <<<"$live_panes"

while IFS=$'\t' read -r pane_key pid cmd dir tty; do
	[ -n "${pane_key:-}" ] || continue
	case "$cmd" in
	claude)
		allow_latest=0
		if [ "${CLAUDE_DIR_COUNTS["$dir"]:-0}" -eq 1 ]; then
			allow_latest=1
		fi
		sid=$(find_claude_session "$dir" "$pid" "$tty" "$allow_latest")
		if [ -n "$sid" ]; then
			found_sessions=1
			CLAUDE_PANE_SESSIONS["$pane_key"]="$sid"
			CLAUDE_PANE_DIRS["$pane_key"]="$dir"
			if [ "$allow_latest" -eq 1 ]; then
				CLAUDE_SESSIONS["$dir"]="$sid"
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
		fi
		;;
	esac
done <<<"$live_panes"

# --- Write companion JSON ---
# Collect all unique directories
declare -A ALL_DIRS
for dir in "${!CLAUDE_SESSIONS[@]}"; do ALL_DIRS["$dir"]=1; done
for dir in "${!OPENCODE_SESSIONS[@]}"; do ALL_DIRS["$dir"]=1; done

if [ "$found_sessions" -eq 0 ]; then
	# No sessions found — remove stale file if present
	rm -f "$SESSION_FILE"
	exit 0
fi

# Build JSON with jq
json='{"version":2,"panes":{}}'
for pane_key in "${!CLAUDE_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${CLAUDE_PANE_DIRS[$pane_key]}" --arg sid "${CLAUDE_PANE_SESSIONS[$pane_key]}" '{dir: $dir, claude: $sid}')
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = $entry')
done
for pane_key in "${!CODEX_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${CODEX_PANE_DIRS[$pane_key]}" --arg sid "${CODEX_PANE_SESSIONS[$pane_key]}" '{dir: $dir, codex: $sid}')
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = (.panes[$pane_key] // {}) + $entry')
done
for pane_key in "${!OPENCODE_PANE_SESSIONS[@]}"; do
	entry=$(jq -n --arg dir "${OPENCODE_PANE_DIRS[$pane_key]}" --arg sid "${OPENCODE_PANE_SESSIONS[$pane_key]}" '{dir: $dir, opencode: $sid}')
	json=$(echo "$json" | jq --arg pane_key "$pane_key" --argjson entry "$entry" '.panes[$pane_key] = (.panes[$pane_key] // {}) + $entry')
done

for dir in "${!ALL_DIRS[@]}"; do
	entry="{}"
	if [ -n "${CLAUDE_SESSIONS[$dir]:-}" ]; then
		entry=$(echo "$entry" | jq --arg sid "${CLAUDE_SESSIONS[$dir]}" '. + {claude: $sid}')
	fi
	if [ -n "${OPENCODE_SESSIONS[$dir]:-}" ]; then
		entry=$(echo "$entry" | jq --arg sid "${OPENCODE_SESSIONS[$dir]}" '. + {opencode: $sid}')
	fi
	json=$(echo "$json" | jq --arg dir "$dir" --argjson entry "$entry" '. + {($dir): $entry}')
done

echo "$json" | jq '.' >"$SESSION_FILE"
