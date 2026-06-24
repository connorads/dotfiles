#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

REAL_SAVE_SESSIONS="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-save-sessions.sh"
REAL_CLAUDE_STRATEGY="$BATS_TEST_DIRNAME/../../tmux/strategies/claude_session_id.sh"
REAL_BASH="$(command -v bash)"

setup() {
  setup_test_home
  SAVE_SESSIONS="$HOME/.config/tmux/scripts/resurrect-save-sessions.sh"
  CLAUDE_STRATEGY="$HOME/.config/tmux/strategies/claude_session_id.sh"
  mkdir -p "$HOME/.config/tmux/scripts" "$HOME/.config/tmux/strategies" "$HOME/.local/share/tmux/resurrect" "$HOME/.claude/sessions"
  cp "$REAL_SAVE_SESSIONS" "$SAVE_SESSIONS"
  cp "$REAL_CLAUDE_STRATEGY" "$CLAUDE_STRATEGY"
  chmod +x "$SAVE_SESSIONS" "$CLAUDE_STRATEGY"
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
