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

# ps stub: a live foreground claude (pid 711) on ttys010. The fork mirrors the
# source pane's launch flags, read from `ps -o args= -p 711`; PS_SOURCE_ARGV sets
# that argv (default bare `claude` -> empty flags -> bare fork).
stub_ps_with_foreground_claude() {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *-t\ ttys010*)
    printf '  700 Ss zsh\n'
    printf '  711 S+ claude\n'
    ;;
  *"args= -p 711"*)
    printf '%s\n' "${PS_SOURCE_ARGV:-claude}"
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

@test "profile pane -> fork command carries CLAUDE_CONFIG_DIR from the live env" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/sessions" "$BATS_TEST_TMPDIR/proc/711"
  printf 'CLAUDE_CONFIG_DIR=%s\0SECRET_TOKEN=hunter2\0' "$cfg" >"$BATS_TEST_TMPDIR/proc/711/environ"
  cat >"$cfg/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF
  stub_ps_with_foreground_claude

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/proc" run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -qF "CLAUDE_CONFIG_DIR=$cfg claude -r session-xyz --fork-session" "$TEST_LOG"
  # The prompt sub-modes must carry the account through too.
  grep -qF "prompt-worktree /Users/connorads session-xyz $cfg" "$TEST_LOG"
  # Never persist any other env var from the live environ.
  assert_log_missing "hunter2"
}

@test "plain source pane -> bare fork (match-source, no skip-perms)" {
  # A bare `claude --resume <id>` / older launch has no override to carry.
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -qF "claude -r session-xyz --fork-session" "$TEST_LOG"
  assert_log_missing "CLAUDE_CONFIG_DIR="
  assert_log_missing "dangerously-skip-permissions"
}

@test "cy-style source pane -> fork mirrors append + skip-perms" {
  export PS_SOURCE_ARGV="claude --append-system-prompt-file /home/x/append.md --dangerously-skip-permissions"
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -qF "claude --append-system-prompt-file /home/x/append.md --dangerously-skip-permissions -r session-xyz --fork-session" "$TEST_LOG"
}

@test "model flag on the source pane is mirrored into the fork" {
  export PS_SOURCE_ARGV="claude --model fable"
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -qF "claude --model fable -r session-xyz --fork-session" "$TEST_LOG"
}

@test "fork-of-fork source -> stale resume/fork state stripped from the mirror" {
  export PS_SOURCE_ARGV="claude --append-system-prompt-file /home/x/append.md -r old-session --fork-session"
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  RESURRECT_PROC_ROOT="$BATS_TEST_TMPDIR/no-proc" run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -qF "claude --append-system-prompt-file /home/x/append.md -r session-xyz --fork-session" "$TEST_LOG"
  assert_log_missing "old-session"
}

@test "fork-repeat threads the mirrored flags into every fork command" {
  # Flags arrive as one positional (shell_quoted upstream) and expand back into
  # separate flags in the fork command.
  local flags="--append-system-prompt-file /home/x/append.md --dangerously-skip-permissions"
  run "$MENU" fork-repeat split-right 3 "%1" "/tmp/work space" "session-xyz" "" "$flags"
  [ "$status" -eq 0 ]
  [ "$(log_count "claude --append-system-prompt-file /home/x/append.md --dangerously-skip-permissions -r session-xyz --fork-session")" -eq 3 ]
}

@test "fork-repeat threads the config dir into every fork command" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  run "$MENU" fork-repeat split-right 3 "%1" "/tmp/work space" "session-xyz" "$cfg"
  [ "$status" -eq 0 ]
  [ "$(log_count "CLAUDE_CONFIG_DIR=$cfg claude -r session-xyz --fork-session")" -eq 3 ]
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

@test "menu offers forking into a different account" {
  stub_ps_with_foreground_claude
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-xyz","cwd":"/Users/connorads","name":"demo","status":"busy"}
EOF

  run "$MENU" "%1" "/dev/ttys010" "/tmp" ""
  [ "$status" -eq 0 ]
  grep -q -- "Fork → other ACCOUNT" "$TEST_LOG"
  # popup runs this script's account-pick mode, threading sid + source dir + cwd.
  grep -q -- "account-pick session-xyz" "$TEST_LOG"
  grep -q -- "display-popup -E" "$TEST_LOG"
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

@test "account-pick relocates the transcript, materialises, and forks under the target" {
  local slug="-Users-connorads-proj" sid="session-xyz" cwd="/Users/connorads/proj"
  # code/$acct dodges the claude-profile-leak-guard concrete-path check.
  local acct=acme target="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$HOME/.claude/projects/$slug" "$target"
  printf 'transcript\n' >"$HOME/.claude/projects/$slug/$sid.jsonl"

  # fzf picks the target account (full label<TAB>dir line).
  write_stub fzf <<EOF
#!/usr/bin/env bash
cat >/dev/null
printf 'work\t%s\n' "$target"
EOF
  write_stub claude-profile-materialise <<'EOF'
#!/usr/bin/env bash
printf 'materialise %s\n' "$*" >>"$TEST_LOG"
EOF

  run "$MENU" account-pick "$sid" "" "" "$cwd" </dev/null
  [ "$status" -eq 0 ]
  # transcript copied into the target account's projects tree
  [ -f "$target/projects/$slug/$sid.jsonl" ]
  # target profile materialised
  grep -qF "materialise $target" "$TEST_LOG"
  # forked in a new window under the target account
  grep -qF "new-window -c $cwd CLAUDE_CONFIG_DIR=$target claude -r $sid --fork-session" "$TEST_LOG"
}

@test "account-pick backs out silently when the source transcript is missing" {
  local acct=acme target="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$target"
  write_stub fzf <<EOF
#!/usr/bin/env bash
cat >/dev/null
printf 'work\t%s\n' "$target"
EOF

  run --separate-stderr "$MENU" account-pick "no-such-sid" "" "" "/Users/connorads/proj" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"could not copy the transcript"* ]]
  assert_log_missing "new-window"
}

@test "account-pick on fzf cancel exits without forking" {
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
exit 130
EOF

  run "$MENU" account-pick "session-xyz" "" "" "/Users/connorads/proj" </dev/null
  [ "$status" -eq 0 ]
  assert_log_missing "new-window"
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
  [ "$(log_count "claude -r session-xyz --fork-session")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-horizontal" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-vertical"
}

@test "fork-repeat split-down creates counted vertical splits then evens layout" {
  run "$MENU" fork-repeat split-down 4 "%1" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  [ "$(log_count "split-window -v")" -eq 4 ]
  [ "$(log_count "claude -r session-xyz --fork-session")" -eq 4 ]
  grep -q -- "select-layout -t %1 even-vertical" "$TEST_LOG"
  assert_log_missing "select-layout -t %1 even-horizontal"
}

@test "fork-repeat new-window opens one counted window per fork" {
  run "$MENU" fork-repeat new-window 4 "%1" "/tmp/work space" "session-xyz"
  [ "$status" -eq 0 ]
  [ "$(log_count "new-window -c /tmp/work space")" -eq 4 ]
  [ "$(log_count "claude -r session-xyz --fork-session")" -eq 4 ]
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
  grep -q -- "new-window -c /tmp/trees/repo/feat/x claude -r session-xyz --fork-session" "$TEST_LOG"
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
  [ "$(log_count "claude -r session-xyz --fork-session")" -eq 4 ]
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
