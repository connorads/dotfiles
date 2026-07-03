#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

REAL_SAVE_SESSIONS="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-save-sessions.sh"
REAL_SESSION_LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/lib/claude-session.sh"
REAL_CLAUDE_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/claude_session_id.sh"
REAL_CODEX_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/codex_session_id.sh"
REAL_OPENCODE_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/opencode_session_id.sh"
REAL_BASH="$(command -v bash)"

setup() {
  setup_test_home
  SAVE_SESSIONS="$HOME/.config/tmux/scripts/resurrect-save-sessions.sh"
  CLAUDE_STRATEGY="$HOME/.config/tmux/strategies/claude_session_id.sh"
  CODEX_STRATEGY="$HOME/.config/tmux/strategies/codex_session_id.sh"
  OPENCODE_STRATEGY="$HOME/.config/tmux/strategies/opencode_session_id.sh"
  mkdir -p "$HOME/.config/tmux/scripts/lib" "$HOME/.config/tmux/strategies" "$HOME/.local/share/tmux/resurrect" "$HOME/.claude/sessions"
  cp "$REAL_SAVE_SESSIONS" "$SAVE_SESSIONS"
  cp "$REAL_SESSION_LIB" "$HOME/.config/tmux/scripts/lib/claude-session.sh"
  cp "$REAL_CLAUDE_STRATEGY" "$CLAUDE_STRATEGY"
  cp "$REAL_CODEX_STRATEGY" "$CODEX_STRATEGY"
  cp "$REAL_OPENCODE_STRATEGY" "$OPENCODE_STRATEGY"
  chmod +x "$SAVE_SESSIONS" "$CLAUDE_STRATEGY" "$CODEX_STRATEGY" "$OPENCODE_STRATEGY"
}

write_tmux_stub_for_save() {
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tclaude\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\tclaude\t/Users/connorads\t/dev/ttys002\n'
	printf 'main:2.1\t333\tzsh\t/Users/connorads\t/dev/ttys003\n'
	exit 0
fi
exit 1
EOF
}

write_ps_stub_for_save() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*)
		printf ' 901 S+ claude\n'
		;;
	*ttys002*)
		printf ' 902 S+ claude\n'
		;;
	*)
		exit 1
		;;
esac
EOF
}

@test "save hook records Claude sessions per pane when cwd repeats" {
  write_tmux_stub_for_save
  write_ps_stub_for_save
  cat >"$HOME/.claude/sessions/901.json" <<'EOF'
{"pid":901,"sessionId":"session-one","cwd":"/Users/connorads"}
EOF
  cat >"$HOME/.claude/sessions/902.json" <<'EOF'
{"pid":902,"sessionId":"session-two","cwd":"/Users/connorads"}
EOF
  touch "$HOME/.local/share/tmux/resurrect/save.txt"

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.version' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "2" ]
  run jq -r '.panes["main:1.1"].claude' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "session-one" ]
  run jq -r '.panes["main:1.2"].claude' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "session-two" ]
  run jq -r 'has("/Users/connorads")' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "false" ]
}

@test "strategy restores the session for the selected pane key" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "claude": "session-one"},
    "main:1.2": {"dir": "/Users/connorads", "claude": "session-two"}
  }
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.2\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$CLAUDE_STRATEGY" "claude --dangerously-skip-permissions" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "claude --resume session-two" ]
}

@test "strategy falls back to legacy cwd mapping" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "/Users/connorads/git/klimble": {"claude": "legacy-session"}
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REAL_BASH" "$CLAUDE_STRATEGY" "claude" "/Users/connorads/git/klimble"

  [ "$status" -eq 0 ]
  [ "$output" = "claude --resume legacy-session" ]
}

@test "strategy continues when duplicate cwd has no pane match" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "claude": "session-one"}
  }
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.9\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$CLAUDE_STRATEGY" "claude" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "claude --continue" ]
}

@test "save hook records Codex sessions per pane when cwd repeats" {
  mkdir -p "$HOME/.codex/sessions/2026/06/24"
  cat >"$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-one","cwd":"/Users/connorads"}}
EOF
  cat >"$HOME/.codex/sessions/2026/06/24/rollout-two.jsonl" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-two","cwd":"/Users/connorads"}}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\tcodex\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\tcodex\t/Users/connorads\t/dev/ttys002\n'
	exit 0
fi
exit 1
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*ttys001*) printf ' 901 S+ codex\n' ;;
	*ttys002*) printf ' 902 S+ codex\n' ;;
	*) exit 1 ;;
esac
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
case "$*" in
	*901*) printf 'codex 901 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-one.jsonl\n' "$HOME" ;;
	*902*) printf 'codex 902 user 10r REG 1,2 0 1 %s/.codex/sessions/2026/06/24/rollout-two.jsonl\n' "$HOME" ;;
	*) exit 1 ;;
esac
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].codex' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "codex-one" ]
  run jq -r '.panes["main:1.2"].codex' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "codex-two" ]
}

@test "Codex strategy restores by pane key and falls back to --last" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "codex": "codex-one"}
  }
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.1\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$CODEX_STRATEGY" "codex" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "codex resume codex-one" ]

  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.2": {"dir": "/Users/connorads", "codex": "codex-two"}
  }
}
EOF

  run "$REAL_BASH" "$CODEX_STRATEGY" "codex" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "codex resume --last" ]
}

@test "Codex strategy falls back to legacy cwd mapping" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "/Users/connorads/git/klimble": {"codex": "legacy-codex"}
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$REAL_BASH" "$CODEX_STRATEGY" "codex" "/Users/connorads/git/klimble"

  [ "$status" -eq 0 ]
  [ "$output" = "codex resume legacy-codex" ]
}

@test "save hook records OpenCode session from current database when cwd is unique" {
  mkdir -p "$HOME/.local/share/opencode"
  : >"$HOME/.local/share/opencode/opencode.db"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  run jq -r '.panes["main:1.1"].opencode' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "ses_current" ]
  run jq -r '.["/Users/connorads"].opencode' "$HOME/.local/share/tmux/resurrect/session_ids.json"
  [ "$output" = "ses_current" ]
}

@test "save hook avoids unsafe OpenCode latest restore when cwd repeats" {
  mkdir -p "$HOME/.local/share/opencode"
  : >"$HOME/.local/share/opencode/opencode.db"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "list-panes" ]; then
	printf 'main:1.1\t111\topencode\t/Users/connorads\t/dev/ttys001\n'
	printf 'main:1.2\t222\topencode\t/Users/connorads\t/dev/ttys002\n'
	exit 0
fi
exit 1
EOF
  write_stub sqlite3 <<'EOF'
#!/usr/bin/env bash
printf 'ses_current\n'
EOF

  run "$REAL_BASH" "$SAVE_SESSIONS" "$HOME/.local/share/tmux/resurrect/save.txt"

  [ "$status" -eq 0 ]
  [ ! -f "$HOME/.local/share/tmux/resurrect/session_ids.json" ]
}

@test "OpenCode strategy restores by pane key and falls back to legacy cwd mapping" {
  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "version": 2,
  "panes": {
    "main:1.1": {"dir": "/Users/connorads", "opencode": "ses_pane"}
  },
  "/Users/connorads": {"opencode": "ses_legacy"}
}
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "display-message" ]; then
	printf 'main:1.1\n'
	exit 0
fi
exit 1
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "opencode --session ses_pane" ]

  cat >"$HOME/.local/share/tmux/resurrect/session_ids.json" <<'EOF'
{
  "/Users/connorads": {"opencode": "ses_legacy"}
}
EOF

  run "$REAL_BASH" "$OPENCODE_STRATEGY" "opencode" "/Users/connorads"

  [ "$status" -eq 0 ]
  [ "$output" = "opencode --session ses_legacy" ]
}
