#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-branch-menu.sh"

log_count() {
  grep -c -- "$1" "$TEST_LOG" || true
}

assert_log_missing() {
  local pattern=$1
  if grep -q -- "$pattern" "$TEST_LOG"; then
    printf 'unexpected log pattern: %s\n' "$pattern" >&2
    return 1
  fi
}

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions"
  export CLAUDE_SESSION_RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"
  # tmux stub records every invocation so we can assert what was shown.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

# ps stub: a live foreground claude (pid 711) on ttys010.
stub_ps_with_foreground_claude() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    ;;
  *) exit 1 ;;
esac
EOF
}

@test "no foreground claude -> 'No Claude in this pane'" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "No Claude in this pane" "$TEST_LOG"
  assert_log_missing "display-menu"
}

@test "claude running but no registry file -> not-forkable message names the pid" {
  stub_ps_with_foreground_claude

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "pid 711" "$TEST_LOG"
  grep -q "not forkable" "$TEST_LOG"
  # it must not fall back to the ambiguous "no Claude" message...
  assert_log_missing "No Claude in this pane"
  # ...and there is nothing to fork, so no menu.
  assert_log_missing "display-menu"
}

@test "claude with no registry but resumable launch args -> opens the branch menu" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    ;;
  *"-o command= -p 711"*)
    printf 'claude --resume session-from-args\n'
    ;;
  *) exit 1 ;;
esac
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q "session-from-args" "$TEST_LOG"
  assert_log_missing "not registered"
  assert_log_missing "\\[resolved\\]"
}

@test "claude with a registry file -> opens the branch menu, no error message" {
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q "session-xyz" "$TEST_LOG"
  assert_log_missing "not registered"
  assert_log_missing "No Claude in this pane"
}

@test "menu offers forking into a new worktree window" {
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "prompt-worktree /Users/connorads session-xyz" "$TEST_LOG"
}

@test "menu offers counted branch actions with expected labels and prompts" {
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q -- "Split right x N R" "$TEST_LOG"
  grep -q -- "Split down x N D" "$TEST_LOG"
  grep -q -- "New windows x N N" "$TEST_LOG"
  grep -q -- "WORKTREE windows x N T" "$TEST_LOG"
  grep -q -- "prompt-repeat split-right" "$TEST_LOG"
  grep -q -- "prompt-repeat split-down" "$TEST_LOG"
  grep -q -- "prompt-repeat new-window" "$TEST_LOG"
  grep -q -- "prompt-worktrees" "$TEST_LOG"
}

@test "prompt-repeat opens the count prompt for a repeated action" {
  run "$MENU" prompt-repeat split-right "\$0:@1.0" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -I 4 -p Fork count:" "$TEST_LOG"
  grep -q -- "fork-repeat split-right %%" "$TEST_LOG"
  grep -qF -- '/tmp/work\\ space' "$TEST_LOG"
}

@test "prompt-worktree opens the single worktree prompt" {
  run "$MENU" prompt-worktree "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -p Worktree branch:" "$TEST_LOG"
  grep -q -- "fork-worktree %% session-xyz" "$TEST_LOG"
}

@test "prompt-worktrees opens one multi-prompt for count and branch prefix" {
  run "$MENU" prompt-worktrees "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -I 4, -p Fork count:,Worktree branch prefix:" "$TEST_LOG"
  grep -q -- "fork-worktrees %% %2 session-xyz" "$TEST_LOG"
}

@test "fork-repeat split-right creates counted horizontal splits then evens layout" {
  run "$MENU" fork-repeat split-right 4 "%1" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  [ "$(log_count "split-window -h")" -eq 4 ]
  [ "$(log_count "claude --dangerously-skip-permissions -r session-xyz --fork-session")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-horizontal" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-vertical"
}

@test "fork-repeat split-down creates counted vertical splits then evens layout" {
  run "$MENU" fork-repeat split-down 4 "%1" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  [ "$(log_count "split-window -v")" -eq 4 ]
  [ "$(log_count "claude --dangerously-skip-permissions -r session-xyz --fork-session")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-vertical" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-horizontal"
}

@test "fork-repeat new-window opens one counted window per fork" {
  run "$MENU" fork-repeat new-window 4 "%1" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  [ "$(log_count "new-window -c /tmp/work space")" -eq 4 ]
  [ "$(log_count "claude --dangerously-skip-permissions -r session-xyz --fork-session")" -eq 4 ]
  assert_log_missing "select-layout"
}

@test "fork-repeat rejects invalid counts without launching forks" {
  run --separate-stderr "$MENU" fork-repeat split-right 9 "%1" "/tmp/work space" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Fork count must be between 1 and 8"* ]]
  assert_log_missing "split-window"
  assert_log_missing "new-window"
}

@test "fork-worktree creates the worktree then opens a window running the fork" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
printf 'wt-add %s\n' "$*" >>"$TEST_LOG"
echo "/tmp/trees/repo/feat/x"
EOF

  run "$MENU" fork-worktree "feat/x" "session-xyz"
  [ "$status" -eq 0 ]
  grep -q "wt-add feat/x" "$TEST_LOG"
  grep -q -- "new-window -c /tmp/trees/repo/feat/x claude --dangerously-skip-permissions -r session-xyz --fork-session" "$TEST_LOG"
}

@test "fork-worktree outside a git repository soft-fails without opening a window" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$MENU" fork-worktree "feat/x" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  assert_log_missing "new-window"
}

@test "fork-worktree rejects branch names with spaces" {
  run --separate-stderr "$MENU" fork-worktree "feat x" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"must not contain spaces"* ]]
  assert_log_missing "new-window"
}

@test "fork-worktrees creates counted worktrees then opens counted windows" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
printf 'wt-add %s\n' "$*" >>"$TEST_LOG"
echo "/tmp/trees/repo/$1"
EOF

  run "$MENU" fork-worktrees 4 "feat/foo" "session-xyz"
  [ "$status" -eq 0 ]
  grep -q -- "wt-add feat/foo-1" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-2" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-3" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-4" "$TEST_LOG"
  [ "$(log_count "new-window -c /tmp/trees/repo/feat/foo-")" -eq 4 ]
  [ "$(log_count "claude --dangerously-skip-permissions -r session-xyz --fork-session")" -eq 4 ]
}

@test "fork-worktrees outside a git repository soft-fails without opening windows" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$MENU" fork-worktrees 4 "feat/foo" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  assert_log_missing "new-window"
}

@test "fork-worktrees rejects invalid counts without launching forks" {
  run --separate-stderr "$MENU" fork-worktrees 0 "feat/foo" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Fork count must be between 1 and 8"* ]]
  assert_log_missing "wt-add"
  assert_log_missing "new-window"
}

@test "fork-worktrees rejects branch prefixes with spaces" {
  run --separate-stderr "$MENU" fork-worktrees 4 "feat foo" "session-xyz" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Branch prefix must not contain spaces"* ]]
  assert_log_missing "wt-add"
  assert_log_missing "new-window"
}
