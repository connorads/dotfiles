#!/usr/bin/env bash
# agent-session.sh: shared resolver for a tmux pane -> agent PID -> live session file.
# Sourced (not executed) by resurrect-save-sessions.sh and branch-menu scripts.
#
# Golden source: Claude Code writes a live per-PID file
# ~/.claude/sessions/<pid>.json holding sessionId/cwd/name/status. The resurrect
# session_ids.json map is a stale save-time cache and must NOT be used for live
# actions.

# agent_foreground_pid_for_tty <tty> <command> [pane_pid]
# Resolve the foreground process named <command> on <tty>. Falls back to a child
# of <pane_pid> when the tty scan finds nothing. Command basename is matched so
# absolute paths / mise shims still match. Empty output when unresolved.
agent_foreground_pid_for_tty() {
	local tty="$1"
	local command="$2"
	local pane_pid="${3:-}"
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

# claude_config_dir_for_pid <pid>
# Read CLAUDE_CONFIG_DIR from the live PID's real environment. Empty output means
# the process runs under the default ~/.claude account (no ccp profile).
# A ccp pane relocates the whole user scope to
# CLAUDE_CONFIG_DIR=~/.claude-profiles/code/<name>, invisible in argv, so live
# actions (branch/fork, resurrect save) must read it from the process itself -
# env introspection is authoritative and never stale, unlike a pane-option cache.
# SECURITY: /proc environ and `ps -E` expose the process's FULL environment
# including real secrets - extract only this var, never persist anything else.
claude_config_dir_for_pid() {
	local pid="$1"
	[ -n "$pid" ] || return 0

	# Linux: null-delimited environ file (RESURRECT_PROC_ROOT overrides for tests).
	local environ="${RESURRECT_PROC_ROOT:-/proc}/$pid/environ"
	if [ -r "$environ" ]; then
		tr '\0' '\n' <"$environ" 2>/dev/null |
			grep -m1 '^CLAUDE_CONFIG_DIR=' | cut -d= -f2- || true
		return 0
	fi

	# macOS: ps -E appends the env as space-separated tokens. Space-containing
	# values are unsupported here (config dir paths contain none).
	ps -E -o command= -p "$pid" 2>/dev/null |
		tr ' ' '\n' |
		grep -m1 '^CLAUDE_CONFIG_DIR=' | cut -d= -f2- || true
}

# claude_session_meta_for_pid <pid> [config_dir]
# Emit the raw JSON of <config_dir>/sessions/<pid>.json (default ~/.claude).
# Empty output if absent. Callers jq out sessionId / name / status / cwd.
claude_session_meta_for_pid() {
	local pid="$1"
	local config_dir="${2:-$HOME/.claude}"
	local session_file="$config_dir/sessions/$pid.json"
	[ -n "$pid" ] || return 0
	[ -f "$session_file" ] || return 0
	cat "$session_file" 2>/dev/null || true
}

# claude_session_resolve_for_pid <pid> [pane_id] [cwd] [config_dir]
# Emit resolver JSON. status=resolved includes sessionId/source/evidence.
claude_session_resolve_for_pid() {
	local pid="$1"
	local pane_id="${2:-}"
	local cwd="${3:-}"
	local config_dir="${4:-}"
	local resolver="${CLAUDE_SESSION_RESOLVER:-$HOME/.config/tmux/scripts/claude-session-resolve.py}"

	[ -n "$pid" ] || return 1
	[ -x "$resolver" ] || return 1

	local -a args
	args=(--pid "$pid")
	[ -n "$pane_id" ] && args+=(--pane "$pane_id")
	[ -n "$cwd" ] && args+=(--cwd "$cwd")
	[ -n "$config_dir" ] && args+=(--config-dir "$config_dir")
	"$resolver" "${args[@]}"
}

# codex_session_file_for_pid <pid>
# Return the active ~/.codex/sessions/.../rollout-*.jsonl held open by Codex.
codex_session_file_for_pid() {
	local pid="$1"

	[ -n "$pid" ] || return 0
	command -v lsof >/dev/null 2>&1 || return 0

	lsof -p "$pid" 2>/dev/null |
		grep '\.jsonl$' |
		grep '/\.codex/sessions/' |
		awk '{print $NF}' |
		head -1 || true
}

# codex_session_resolve_for_pid <pid> [cwd]
# Emit resolver JSON. status=resolved includes sessionId/cwd/rolloutPath.
codex_session_resolve_for_pid() {
	local pid="$1"
	local cwd="${2:-}"
	local session_file=""

	session_file=$(codex_session_file_for_pid "$pid")
	[ -n "$session_file" ] || return 1
	[ -f "$session_file" ] || return 1
	command -v jq >/dev/null 2>&1 || return 1

	jq -c --arg dir "$cwd" --arg rollout "$session_file" '
		select(.type == "session_meta")
		| select(($dir == "") or ((.payload.cwd // $dir) == $dir))
		| {
			status: "resolved",
			sessionId: (.payload.id // ""),
			cwd: (.payload.cwd // ""),
			rolloutPath: $rollout,
			cliVersion: (.payload.cli_version // ""),
			threadSource: (.payload.thread_source // "")
		}
		| select(.sessionId != "")
	' "$session_file" 2>/dev/null | head -1 || true
}

# codex_session_id_for_pid <pid> [cwd]
# Return the active Codex thread id. Uses payload.id, not payload.session_id.
codex_session_id_for_pid() {
	local pid="$1"
	local cwd="${2:-}"

	codex_session_resolve_for_pid "$pid" "$cwd" |
		jq -r '.sessionId // empty' 2>/dev/null | head -1 || true
}
