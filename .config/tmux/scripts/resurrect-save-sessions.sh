#!/usr/bin/env bash
# resurrect-save-sessions.sh: post-save hook for tmux-resurrect
# Discovers active Claude Code and OpenCode session IDs and writes a
# companion JSON file that strategy scripts read at restore time.

set -euo pipefail

SAVE_FILE="$1"
RESURRECT_DIR="$(dirname "$SAVE_FILE")"
SESSION_FILE="$RESURRECT_DIR/session_ids.json"

# Require jq
if ! command -v jq &>/dev/null; then
	exit 0
fi

declare -A CLAUDE_SESSIONS
declare -A CLAUDE_PANE_SESSIONS
declare -A CLAUDE_PANE_DIRS
declare -A CLAUDE_DIR_COUNTS
declare -A OPENCODE_SESSIONS
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

	claude_pid=$(foreground_pid_for_command "$tty" "claude" "$pane_pid")

	# Claude Code writes the active session ID keyed by its process PID.
	if [ -n "$claude_pid" ]; then
		local session_file="$HOME/.claude/sessions/$claude_pid.json"
		if [ -f "$session_file" ]; then
			session_id=$(jq -r --arg dir "$dir" 'select((.cwd // $dir) == $dir) | .sessionId // empty' "$session_file" 2>/dev/null || true)
		fi
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

foreground_pid_for_command() {
	local tty="$1"
	local command="$2"
	local pane_pid="$3"
	local pid=""

	if [ -n "$tty" ]; then
		pid=$(ps -t "${tty#/dev/}" -o pid=,stat=,comm= 2>/dev/null |
			awk -v want="$command" '
        $2 ~ /\+/ {
          c=$3
          sub(/.*\//, "", c)
          if (c == want) {
            print $1
            exit
          }
        }')
	fi

	if [ -z "$pid" ] && [ -n "$pane_pid" ]; then
		pid=$(ps -ao pid=,ppid=,comm= 2>/dev/null |
			awk -v ppid="$pane_pid" -v want="$command" '
        $2 == ppid {
          c=$3
          sub(/.*\//, "", c)
          if (c == want) {
            print $1
            exit
          }
        }')
	fi

	echo "$pid"
}

# --- OpenCode session discovery ---
# Session files: ~/.local/share/opencode/storage/session/<project-id>/ses_*.json
# Project mapping: ~/.local/share/opencode/storage/project/*.json (id -> worktree)
find_opencode_session() {
	local dir="$1"
	local pid="$2"
	local session_id=""

	# Try lsof first
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		session_id=$(lsof -p "$pid" 2>/dev/null |
			grep '/opencode/storage/session/' |
			grep '\.json$' |
			awk '{print $NF}' |
			head -1 |
			xargs -I{} basename {} .json 2>/dev/null || true)
	fi

	# Fallback: find project ID for this directory, then most recent session file
	if [ -z "$session_id" ]; then
		local project_dir="$HOME/.local/share/opencode/storage/project"
		if [ -d "$project_dir" ]; then
			local project_id=""
			# Search project files for matching worktree
			for pf in "$project_dir"/*.json; do
				[ -f "$pf" ] || continue
				local worktree
				worktree=$(jq -r '.worktree // empty' "$pf" 2>/dev/null)
				if [ "$worktree" = "$dir" ]; then
					project_id=$(jq -r '.id // empty' "$pf" 2>/dev/null)
					break
				fi
			done

			if [ -n "$project_id" ]; then
				local session_dir="$HOME/.local/share/opencode/storage/session/$project_id"
				if [ -d "$session_dir" ]; then
					local latest
					# shellcheck disable=SC2012  # mtime ordering is the fallback behaviour.
					latest=$(ls -t "$session_dir"/ses_*.json 2>/dev/null | head -1)
					if [ -n "$latest" ]; then
						session_id=$(basename "$latest" .json)
					fi
				fi
			fi
		fi
	fi

	echo "$session_id"
}

# --- Get pane PIDs from tmux (still running at hook time) ---
# Returns: session:window.pane<TAB>pid<TAB>command<TAB>cwd<TAB>tty
get_live_panes() {
	tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}	#{pane_pid}	#{pane_current_command}	#{pane_current_path}	#{pane_tty}' 2>/dev/null || true
}

# --- Parse save file for panes running claude or opencode ---
# Save file pane format (tab-delimited):
# pane<TAB>session<TAB>window<TAB>win_active<TAB>:flags<TAB>pane_idx<TAB>:title<TAB>:dir<TAB>pane_active<TAB>pane_cmd<TAB>:full_cmd
# But PID is not in the save file — we use live tmux panes instead.

# Read live pane data and match against claude/opencode
live_panes=$(get_live_panes)

while IFS=$'\t' read -r pane_key pid cmd dir tty; do
	[ -n "${pane_key:-}" ] || continue
	if [ "$cmd" = "claude" ]; then
		CLAUDE_DIR_COUNTS["$dir"]=$((${CLAUDE_DIR_COUNTS["$dir"]:-0} + 1))
	fi
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
	opencode)
		sid=$(find_opencode_session "$dir" "$pid")
		if [ -n "$sid" ]; then
			found_sessions=1
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
