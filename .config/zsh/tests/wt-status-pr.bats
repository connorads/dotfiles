#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_ADD="$FUNCTIONS_DIR/git/wt-add"
WT_STATUS="$FUNCTIONS_DIR/git/wt-status"

setup() {
  setup_test_home
}

make_repo() {
  local repo=$1

  git init -b main "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null
}

# gh stub: we replace gh wholesale, so it must emit the TSV that real gh would
# produce *after* applying --jq, i.e. headRefName<TAB>state<TAB>number<TAB>url<TAB>isDraft.
stub_gh_pr_list() {
  local rows=$1
  write_stub gh <<EOF
#!/usr/bin/env bash
printf 'gh %s\n' "\$*" >> "\$TEST_LOG"
if [ "\$1" = "pr" ] && [ "\$2" = "list" ]; then
  printf '%b' "$rows"
  exit 0
fi
exit 1
EOF
}

@test "wt-status --pr reports a MERGED PR state and number" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh_pr_list 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run bash -lc "cd /tmp && HOME='$HOME' TEST_LOG='$TEST_LOG' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --pr --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "MERGED" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_number')" = "42" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_url')" = "https://example.test/pr/42" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_is_draft')" = "false" ]
}

@test "wt-status --pr reports none for a branch with no PR" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  # gh succeeds but lists no PR for this branch.
  stub_gh_pr_list 'other\tOPEN\t7\thttps://example.test/pr/7\tfalse\n'

  run bash -lc "cd /tmp && HOME='$HOME' TEST_LOG='$TEST_LOG' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --pr --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "none" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_number')" = "null" ]
}

@test "wt-status --pr degrades to unknown when gh is unavailable" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  # No gh stub, and the sanitised test PATH has no gh: command -v gh fails.
  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --pr --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "unknown" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_number')" = "null" ]
}

@test "wt-status without --pr makes no gh call and leaves PR fields null" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  # gh stub logs and fails; the default path must never invoke it.
  write_stub gh <<'EOF'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$TEST_LOG"
exit 1
EOF

  run bash -lc "cd /tmp && HOME='$HOME' TEST_LOG='$TEST_LOG' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "unknown" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_number')" = "null" ]
  [ ! -s "$TEST_LOG" ]
}

@test "wt-status without --pr keeps the 11-field TSV contract" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | awk -F'\t' '{print NF}')" -eq 11 ]
}

# gh stub that counts every `gh pr list` invocation into $HOME/gh-calls. Guards
# the regression where _wt_pr_lookup ran under command-substitution: its per-repo
# cache was written inside the subshell and discarded, so gh was called once per
# worktree instead of once per repo.
stub_gh_pr_list_counting() {
  local rows=$1
  : >"$HOME/gh-calls"
  write_stub gh <<EOF
#!/usr/bin/env bash
if [ "\$1" = "pr" ] && [ "\$2" = "list" ]; then
  printf 'x\n' >> "\$HOME/gh-calls"
  printf '%b' "$rows"
  exit 0
fi
exit 1
EOF
}

@test "wt-status --pr calls gh once per repo across many worktrees" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  # Three worktrees, all sharing the one repo's common dir -> one gh call.
  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]
  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup feat"
  [ "$status" -eq 0 ]
  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup fix"
  [ "$status" -eq 0 ]

  stub_gh_pr_list_counting 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --pr --json"

  [ "$status" -eq 0 ]
  # PR state still resolved correctly from the single shared cache.
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "MERGED" ]
  # One gh call for three worktrees of the same repo (was three before the fix).
  [ "$(wc -l <"$HOME/gh-calls" | tr -d ' ')" -eq 1 ]
}
