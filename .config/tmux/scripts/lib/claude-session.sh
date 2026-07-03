#!/usr/bin/env bash
# claude-session.sh: shared resolver for a tmux pane -> agent PID -> live session file.
# Sourced (not executed) by resurrect-save-sessions.sh and claude-branch-menu.sh.
#
# Golden source: Claude Code writes a live per-PID file
# ~/.claude/sessions/<pid>.json holding sessionId/cwd/name/status. The resurrect
# session_ids.json map is a stale save-time cache and must NOT be used for live
# actions.

# claude_foreground_pid_for_tty <tty> <command> [pane_pid]
# Resolve the foreground process named <command> on <tty>. Falls back to a child
# of <pane_pid> when the tty scan finds nothing. Command basename is matched so
# absolute paths / mise shims still match. Empty output when unresolved.
claude_foreground_pid_for_tty() {
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

# claude_session_meta_for_pid <pid>
# Emit the raw JSON of ~/.claude/sessions/<pid>.json. Empty output if absent.
# Callers jq out sessionId / name / status / cwd.
claude_session_meta_for_pid() {
	local pid="$1"
	local session_file="$HOME/.claude/sessions/$pid.json"
	[ -n "$pid" ] || return 0
	[ -f "$session_file" ] || return 0
	cat "$session_file" 2>/dev/null || true
}
