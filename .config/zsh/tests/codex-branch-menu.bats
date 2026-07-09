#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MENU="$BATS_TEST_DIRNAME/../../tmux/scripts/codex-branch-menu.sh"

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
  mkdir -p "$HOME/.codex/sessions/2026/06/24"
  # tmux stub records every invocation so we can assert what was shown.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
EOF
}

# ps stub: a live foreground codex (pid 811) on ttys010.
stub_ps_with_foreground_codex() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  800 Ss zsh\n'
    printf '  811 S+ codex\n'
    ;;
  *) exit 1 ;;
esac
EOF
}

stub_lsof_rollout() {
  export CODEX_ROLLOUT="$HOME/.codex/sessions/2026/06/24/rollout-one.jsonl"
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-p\ 811*) printf 'codex 811 user 10r REG 1,2 0 1 %s\n' "$CODEX_ROLLOUT" ;;
  *) exit 1 ;;
esac
EOF
}

write_valid_rollout() {
  cat >"$CODEX_ROLLOUT" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-thread","session_id":"wrong-session","cwd":"/Users/connorads","cli_version":"0.142.5","thread_source":"resume"}}
{"type":"response_item","payload":{"text":"ignored"}}
EOF
}

@test "no foreground codex -> 'No Codex in this pane'" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "No Codex in this pane" "$TEST_LOG"
  assert_log_missing "display-menu"
}

@test "codex running but no rollout -> not-forkable message names the pid" {
  stub_ps_with_foreground_codex
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "pid 811" "$TEST_LOG"
  grep -q "no active rollout" "$TEST_LOG"
  grep -q "not forkable" "$TEST_LOG"
  assert_log_missing "No Codex in this pane"
  assert_log_missing "display-menu"
}

@test "missing lsof -> useful dependency message" {
  write_stub jq <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run env PATH="$TEST_BIN:/usr/bin:/bin" /bin/bash "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "lsof not found - cannot branch Codex session" "$TEST_LOG"
  assert_log_missing "display-menu"
}

@test "missing jq -> useful dependency message" {
  write_stub dirname <<'EOF'
#!/usr/bin/env bash
case "$1" in
  */*) printf '%s\n' "${1%/*}" ;;
  *) printf '.\n' ;;
esac
EOF

  run env PATH="$TEST_BIN:/bin:/usr/sbin:/sbin" /bin/bash "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "jq not found - cannot branch Codex session" "$TEST_LOG"
  assert_log_missing "display-menu"
}

@test "codex rollout opens branch menu with fork command" {
  stub_ps_with_foreground_codex
  stub_lsof_rollout
  write_valid_rollout

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "codex --dangerously-bypass-approvals-and-sandbox -C /Users/connorads fork codex-thread" "$TEST_LOG"
  grep -q "codex-thread" "$TEST_LOG"
  assert_log_missing "wrong-session"
}

@test "rollout from a different cwd is not forkable for this pane" {
  stub_ps_with_foreground_codex
  stub_lsof_rollout
  cat >"$CODEX_ROLLOUT" <<'EOF'
{"type":"session_meta","payload":{"id":"codex-thread","cwd":"/Users/connorads/other"}}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "pid 811" "$TEST_LOG"
  grep -q "no active rollout" "$TEST_LOG"
  assert_log_missing "display-menu"
}

@test "menu offers forking into a new worktree window" {
  stub_ps_with_foreground_codex
  stub_lsof_rollout
  write_valid_rollout

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
  [ "$status" -eq 0 ]
  grep -q "prompt-worktree /Users/connorads codex-thread" "$TEST_LOG"
}

@test "menu offers counted branch actions with expected labels and prompts" {
  stub_ps_with_foreground_codex
  stub_lsof_rollout
  write_valid_rollout

  run "$MENU" "%1" "/dev/ttys010" "/Users/connorads" ""
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
  run "$MENU" prompt-repeat split-right "\$0:@1.0" "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -I 4 -p Fork count:" "$TEST_LOG"
  grep -q -- "fork-repeat split-right %%" "$TEST_LOG"
  grep -qF -- '/tmp/work\\ space' "$TEST_LOG"
}

@test "prompt-worktree opens the single worktree prompt" {
  run "$MENU" prompt-worktree "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -p Worktree branch:" "$TEST_LOG"
  grep -q -- "fork-worktree %% codex-thread" "$TEST_LOG"
}

@test "prompt-worktrees opens one multi-prompt for count and branch prefix" {
  run "$MENU" prompt-worktrees "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  grep -q -- "command-prompt -I 4, -p Fork count:,Worktree branch prefix:" "$TEST_LOG"
  grep -q -- "fork-worktrees %% %2 codex-thread" "$TEST_LOG"
}

@test "fork-repeat split-right creates counted horizontal splits then evens layout" {
  run "$MENU" fork-repeat split-right 4 "%1" "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  [ "$(log_count "split-window -h")" -eq 4 ]
  [ "$(log_count "codex --dangerously-bypass-approvals-and-sandbox -C /tmp/work\\\\ space fork codex-thread")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-horizontal" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-vertical"
}

@test "fork-repeat split-down creates counted vertical splits then evens layout" {
  run "$MENU" fork-repeat split-down 4 "%1" "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  [ "$(log_count "split-window -v")" -eq 4 ]
  [ "$(log_count "codex --dangerously-bypass-approvals-and-sandbox -C /tmp/work\\\\ space fork codex-thread")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-vertical" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-horizontal"
}

@test "fork-repeat new-window opens one counted window per fork" {
  run "$MENU" fork-repeat new-window 4 "%1" "/tmp/work space" "codex-thread"
  [ "$status" -eq 0 ]
  [ "$(log_count "new-window -c /tmp/work space")" -eq 4 ]
  [ "$(log_count "codex --dangerously-bypass-approvals-and-sandbox -C /tmp/work\\\\ space fork codex-thread")" -eq 4 ]
  assert_log_missing "select-layout"
}

@test "fork-repeat rejects invalid counts without launching forks" {
  run --separate-stderr "$MENU" fork-repeat split-right 9 "%1" "/tmp/work space" "codex-thread" </dev/null
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

  run "$MENU" fork-worktree "feat/x" "codex-thread"
  [ "$status" -eq 0 ]
  grep -q "wt-add feat/x" "$TEST_LOG"
  grep -q -- "new-window -c /tmp/trees/repo/feat/x codex --dangerously-bypass-approvals-and-sandbox -C /tmp/trees/repo/feat/x fork codex-thread" "$TEST_LOG"
}

@test "fork-worktree outside a git repository soft-fails without opening a window" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$MENU" fork-worktree "feat/x" "codex-thread" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  assert_log_missing "new-window"
}

@test "fork-worktree rejects branch names with spaces" {
  run --separate-stderr "$MENU" fork-worktree "feat x" "codex-thread" </dev/null
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

  run "$MENU" fork-worktrees 4 "feat/foo" "codex-thread"
  [ "$status" -eq 0 ]
  grep -q -- "wt-add feat/foo-1" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-2" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-3" "$TEST_LOG"
  grep -q -- "wt-add feat/foo-4" "$TEST_LOG"
  [ "$(log_count "new-window -c /tmp/trees/repo/feat/foo-")" -eq 4 ]
  [ "$(log_count "codex --dangerously-bypass-approvals-and-sandbox -C /tmp/trees/repo/feat/foo-")" -eq 4 ]
}

@test "fork-worktrees outside a git repository soft-fails without opening windows" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$MENU" fork-worktrees 4 "feat/foo" "codex-thread" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  assert_log_missing "new-window"
}

@test "fork-worktrees rejects invalid counts without launching forks" {
  run --separate-stderr "$MENU" fork-worktrees 0 "feat/foo" "codex-thread" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Fork count must be between 1 and 8"* ]]
  assert_log_missing "wt-add"
  assert_log_missing "new-window"
}

@test "fork-worktrees rejects branch prefixes with spaces" {
  run --separate-stderr "$MENU" fork-worktrees 4 "feat foo" "codex-thread" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Branch prefix must not contain spaces"* ]]
  assert_log_missing "wt-add"
  assert_log_missing "new-window"
}
