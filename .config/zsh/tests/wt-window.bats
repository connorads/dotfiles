#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_WINDOW="$BATS_TEST_DIRNAME/../../tmux/scripts/wt-window.sh"

setup() {
  setup_test_home
  # Fast render sources _wt_managed_worktrees from _wt-common; point at the repo
  # copy since the throwaway HOME carries no dotfiles.
  export WT_COMMON="$FUNCTIONS_DIR/git/_wt-common"
  # tmux stub: logs every invocation; answers list-panes from $TMUX_PANES and
  # display-message (summoning pane) with %9.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "list-panes" ]; then
  printf '%s\n' "${TMUX_PANES:-}"
elif [ "$1" = "display-message" ]; then
  echo "%9"
fi
EOF
}

@test "open focuses the window whose pane cwd is the worktree path" {
  export TMUX_PANES=$'@1\t/tmp/elsewhere\n@2\t/tmp/trees/repo/foo'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q "switch-client -t @2" "$TEST_LOG"
  grep -q "select-window -t @2" "$TEST_LOG"
  ! grep -q "new-window" "$TEST_LOG"
}

@test "open focuses a window whose pane cwd is inside the worktree" {
  export TMUX_PANES=$'@3\t/tmp/trees/repo/foo/src/deep'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q "switch-client -t @3" "$TEST_LOG"
}

@test "open creates a new window when nothing matches" {
  export TMUX_PANES=$'@1\t/tmp/elsewhere'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q -- "new-window -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "switch-client" "$TEST_LOG"
}

@test "open matches on path boundaries, not bare prefixes" {
  # A pane in repo/foobar must NOT satisfy repo/foo.
  export TMUX_PANES=$'@4\t/tmp/trees/repo/foobar'

  run "$WT_WINDOW" open "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q -- "new-window -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "switch-client" "$TEST_LOG"
}

@test "pane splits the summoning pane at the worktree path" {
  run "$WT_WINDOW" pane "/tmp/trees/repo/foo"

  [ "$status" -eq 0 ]
  grep -q -- "split-window -h -t %9 -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "new-window" "$TEST_LOG"
}

@test "pane splits the explicit origin when one is supplied" {
  # A float becomes the active pane, so float callers pass the origin rather
  # than letting the dynamic lookup resolve to the float itself.
  run "$WT_WINDOW" pane "/tmp/trees/repo/foo" "%3"

  [ "$status" -eq 0 ]
  grep -q -- "split-window -h -t %3 -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "display-message" "$TEST_LOG"
}

@test "new runs wt-add and opens a window in the printed path on enter" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
printf 'wt-add %s\n' "$*" >>"$TEST_LOG"
echo "/tmp/trees/repo/feat/x"
EOF

  run "$WT_WINDOW" new "feat/x" </dev/null

  [ "$status" -eq 0 ]
  grep -q "wt-add feat/x" "$TEST_LOG"
  grep -q -- "new-window -c /tmp/trees/repo/feat/x" "$TEST_LOG"
  ! grep -q "split-window" "$TEST_LOG"
}

@test "new opens a pane in the summoning window when v is pressed" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
echo "/tmp/trees/repo/feat/x"
EOF

  run "$WT_WINDOW" new "feat/x" <<<"v"

  [ "$status" -eq 0 ]
  grep -q -- "split-window -h -t %9 -c /tmp/trees/repo/feat/x" "$TEST_LOG"
  ! grep -q "new-window" "$TEST_LOG"
}

@test "new threads its explicit origin through to the v pane split" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  write_stub wt-add <<'EOF'
#!/usr/bin/env bash
echo "/tmp/trees/repo/feat/x"
EOF

  run "$WT_WINDOW" new "feat/x" "%3" <<<"v"

  [ "$status" -eq 0 ]
  grep -q -- "split-window -h -t %3 -c /tmp/trees/repo/feat/x" "$TEST_LOG"
  ! grep -q "display-message" "$TEST_LOG"
}

@test "pick routes ctrl-v to a pane in the summoning window" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[{"path":"/tmp/trees/repo/foo","branch":"foo","dirty":false}]'
EOF
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'ctrl-v\n/tmp/trees/repo/foo\tfoo\n'
EOF

  run "$WT_WINDOW" pick

  [ "$status" -eq 0 ]
  grep -q -- "split-window -h -t %9 -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "new-window" "$TEST_LOG"
}

@test "pick routes enter through open" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[{"path":"/tmp/trees/repo/foo","branch":"foo","dirty":false}]'
EOF
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf '\n/tmp/trees/repo/foo\tfoo\n'
EOF
  export TMUX_PANES=$'@1\t/tmp/elsewhere'

  run "$WT_WINDOW" pick

  [ "$status" -eq 0 ]
  grep -q -- "new-window -c /tmp/trees/repo/foo" "$TEST_LOG"
  ! grep -q "split-window" "$TEST_LOG"
}

# Stateful fzf stub for ctrl-x reload tests: appends its stdin to
# $HOME/fzf-input, prints a ctrl-x selection on the first call, and aborts
# (exit 130) on later calls so the re-exec'd pick terminates. Call count in
# $HOME/fzf-calls. $FZF_SELECT holds the selected TSV line.
write_ctrl_x_fzf_stub() {
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >>"$HOME/fzf-input"
n=$(( $(cat "$HOME/fzf-calls" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$HOME/fzf-calls"
[ "$n" -gt 1 ] && exit 130
printf 'ctrl-x\n%s\n' "$FZF_SELECT"
EOF
}

@test "pick-render full rows carry repo, a fixed PR-state column, then branch and flags" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
printf 'wt-status %s\n' "$*" >>"$TEST_LOG"
cat <<'JSON'
[
  {"path":"/tmp/x/.trees/delta/rebased","branch":"rebased","dirty":false,"untracked":false,"ahead":0,"behind":0,"merged_into_base":false,"pr_state":"MERGED","pr_number":966},
  {"path":"/tmp/x/.trees/gamma/keep","branch":"keep","dirty":true,"untracked":false,"ahead":1,"behind":0,"merged_into_base":true,"pr_state":"MERGED","pr_number":42},
  {"path":"/tmp/x/.trees/beta/wip","branch":"wip","dirty":false,"untracked":false,"ahead":2,"behind":1,"merged_into_base":false,"pr_state":"OPEN","pr_number":7},
  {"path":"/tmp/x/.trees/alpha/feat","branch":"feat","dirty":false,"untracked":true,"ahead":0,"behind":0,"merged_into_base":false,"pr_state":"none","pr_number":null}
]
JSON
EOF
  export TMUX_PANES=$'@7\t/tmp/x/.trees/alpha/feat/src'

  run "$WT_WINDOW" pick-render full

  [ "$status" -eq 0 ]
  # wt-status is queried for the real (squash/rebase-aware) PR signal.
  grep -q -- "wt-status --all --pr --json" "$TEST_LOG"
  # Markers are ANSI-coloured; strip codes for the layout assertions.
  printf '%s\n' "$output" | sed $'s/\x1b\\[[0-9;]*m//g' >"$HOME/plain"
  # Sorted by repo: alpha first although wt-status emitted it last.
  head -1 "$HOME/plain" | grep -q "alpha"
  # Hidden path field 1, then repo, then the PR verdict ahead of branch.
  grep -q $'^/tmp/x/.trees/alpha/feat\talpha' "$HOME/plain"
  # MERGED + clean + not-ahead → reap; PR token sits before the branch.
  grep -Eq 'delta +✓ reap +rebased' "$HOME/plain"
  # MERGED + dirty/unpushed → merged (not reap), local flags trail.
  grep -Eq 'gamma +✓ merged +keep +● dirty ↑1$' "$HOME/plain"
  # OPEN state, with ahead/behind flags trailing after the branch.
  grep -Eq 'beta +○ open +wip +↑2 ↓1$' "$HOME/plain"
  # No PR → the "-" verdict; live pane (inside the tree) leads the flags,
  # ahead of the dirty marker (untracked counts as dirty).
  grep -Eq 'alpha +· - +feat +◉ live ● dirty$' "$HOME/plain"
  # reap renders bright-green so fzf --ansi shows it coloured.
  printf '%s\n' "$output" | grep -q $'\x1b\\[92m✓ reap'
}

@test "pick-render full degrades to the local merged hint when PR state is unknown" {
  # Offline / no gh: wt-status --pr yields pr_state=unknown; the renderer falls
  # back to the local merged_into_base ancestry hint rather than crashing.
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
cat <<'JSON'
[
  {"path":"/tmp/x/.trees/repo/anc","branch":"anc","dirty":false,"untracked":false,"ahead":0,"behind":0,"merged_into_base":true,"pr_state":"unknown","pr_number":null},
  {"path":"/tmp/x/.trees/repo/live","branch":"live","dirty":false,"untracked":false,"ahead":0,"behind":0,"merged_into_base":false,"pr_state":"unknown","pr_number":null}
]
JSON
EOF

  run "$WT_WINDOW" pick-render full

  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | sed $'s/\x1b\\[[0-9;]*m//g' >"$HOME/plain"
  # merged_into_base → "? merged" hint; otherwise "? …".
  grep -Eq 'repo +\? merged +anc' "$HOME/plain"
  grep -Eq 'repo +\? … +live' "$HOME/plain"
}

@test "pick-render fast paints repo, branch, a loading PR token, and the live flag" {
  # Managed-worktree fixture: two dirs holding a .git marker under ~/.trees.
  mkdir -p "$HOME/.trees/repo/foo" "$HOME/.trees/repo/bar"
  : >"$HOME/.trees/repo/foo/.git"
  : >"$HOME/.trees/repo/bar/.git"
  # branch via `git -C <wt> branch --show-current`; no git status / gh.
  write_stub git <<'EOF'
#!/usr/bin/env bash
if [ "$3" = "branch" ] && [ "$4" = "--show-current" ]; then
  case "$2" in
  */foo) echo "foo-branch" ;;
  */bar) echo "bar-branch" ;;
  esac
fi
EOF
  export TMUX_PANES=$'@2\t'"$HOME/.trees/repo/foo"

  run "$WT_WINDOW" pick-render fast

  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | sed $'s/\x1b\\[[0-9;]*m//g' >"$HOME/plain"
  # Hidden path field 1, then repo. Sorted by branch: bar before foo.
  head -1 "$HOME/plain" | grep -q $'^'"$HOME"'/.trees/repo/bar\trepo'
  # Loading PR token; the live pane (inside foo) flags foo, not bar.
  grep -Eq 'repo +⋯ … +bar-branch *$' "$HOME/plain"
  grep -Eq 'repo +⋯ … +foo-branch +◉ live$' "$HOME/plain"
}

@test "pick-render emits nothing when there are no managed worktrees" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[]'
EOF

  run "$WT_WINDOW" pick-render fast </dev/null
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  run "$WT_WINDOW" pick-render full </dev/null
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "pick feeds the fast render to fzf and wires a full-reload load bind" {
  mkdir -p "$HOME/.trees/repo/foo"
  : >"$HOME/.trees/repo/foo/.git"
  write_stub git <<'EOF'
#!/usr/bin/env bash
[ "$3" = "branch" ] && echo "foo"
EOF
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
printf 'fzf %s\n' "$*" >>"$TEST_LOG"
cat >>"$HOME/fzf-input"
exit 130
EOF

  run "$WT_WINDOW" pick </dev/null

  [ "$status" -eq 0 ]
  grep -q -- "--ansi" "$TEST_LOG"
  grep -q -- "--preview" "$TEST_LOG"
  # load-triggered transform reloads the full render as a fresh process.
  grep -q "load:transform" "$TEST_LOG"
  grep -q "pick-render full" "$TEST_LOG"
  # The initial pipe is the FAST render: its loading token reaches fzf's stdin.
  sed $'s/\x1b\\[[0-9;]*m//g' "$HOME/fzf-input" >"$HOME/fzf-plain"
  grep -Eq 'repo +⋯ … +foo *$' "$HOME/fzf-plain"
}

@test "pick ctrl-x removes a clean pane-free worktree and reloads the list" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[{"path":"/tmp/x/.trees/repo/feat","branch":"feat","dirty":false}]'
EOF
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >>"$TEST_LOG"
echo "$1"
EOF
  write_ctrl_x_fzf_stub
  export FZF_SELECT=$'/tmp/x/.trees/repo/feat\trepo  feat'

  run "$WT_WINDOW" pick </dev/null

  [ "$status" -eq 0 ]
  grep -q -- "wt-remove --delete-branch /tmp/x/.trees/repo/feat" "$TEST_LOG"
  # Reload: pick re-execs and fzf runs a second time (aborted by the stub).
  [ "$(cat "$HOME/fzf-calls")" = "2" ]
}

@test "pick ctrl-x refuses when the worktree has an open pane" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[{"path":"/tmp/x/.trees/repo/feat","branch":"feat","dirty":false}]'
EOF
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >>"$TEST_LOG"
EOF
  write_ctrl_x_fzf_stub
  export FZF_SELECT=$'/tmp/x/.trees/repo/feat\trepo  feat'
  export TMUX_PANES=$'@3\t/tmp/x/.trees/repo/feat'

  run --separate-stderr "$WT_WINDOW" pick </dev/null

  [ "$status" -eq 0 ]
  ! grep -q "wt-remove" "$TEST_LOG"
  [[ "$stderr" == *"close it first"* ]]
  [ "$(cat "$HOME/fzf-calls")" = "2" ]
}

@test "pick ctrl-x surfaces wt-remove's refusal and still reloads" {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
echo '[{"path":"/tmp/x/.trees/repo/feat","branch":"feat","dirty":true}]'
EOF
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
echo "error: worktree has uncommitted changes" >&2
exit 1
EOF
  write_ctrl_x_fzf_stub
  export FZF_SELECT=$'/tmp/x/.trees/repo/feat\trepo  feat dirty'

  run --separate-stderr "$WT_WINDOW" pick </dev/null

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"uncommitted changes"* ]]
  [[ "$stderr" == *"wt-remove refused"* ]]
  [ "$(cat "$HOME/fzf-calls")" = "2" ]
}

@test "new outside a git repository soft-fails without opening a window" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 128
EOF

  run --separate-stderr "$WT_WINDOW" new "feat/x" </dev/null

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Not in a git repository"* ]]
  ! grep -q "new-window" "$TEST_LOG"
}

@test "new rejects branch names with spaces" {
  write_stub git <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run --separate-stderr "$WT_WINDOW" new "feat x" </dev/null

  [ "$status" -eq 0 ]
  [[ "$stderr" == *"must not contain spaces"* ]]
  ! grep -q "new-window" "$TEST_LOG"
}
