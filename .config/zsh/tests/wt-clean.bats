#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_ADD="$FUNCTIONS_DIR/git/wt-add"
WT_CLEAN="$FUNCTIONS_DIR/git/wt-clean"

setup() {
  setup_test_home
  # wt-clean shells out to `wt-status` and `wt-remove` by name; expose the real
  # dual-mode functions on the sanitised test PATH via TEST_BIN symlinks.
  ln -s "$FUNCTIONS_DIR/git/wt-status" "$TEST_BIN/wt-status"
  ln -s "$FUNCTIONS_DIR/git/wt-remove" "$TEST_BIN/wt-remove"
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

make_remote_repo() {
  local remote=$1
  git init --bare "$remote" >/dev/null
  git --git-dir="$remote" symbolic-ref HEAD refs/heads/main
}

# gh stub: replaces gh wholesale, so it emits the TSV real gh would produce after
# --jq: headRefName<TAB>state<TAB>number<TAB>url<TAB>isDraft, one row per PR.
stub_gh() {
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

run_clean() {
  # Run wt-clean from the base repo (cwd), forwarding args.
  local repo=$1
  shift
  run bash -lc "cd '$repo' && HOME='$HOME' TEST_LOG='$TEST_LOG' PATH='$PATH' zsh --no-rcs '$WT_CLEAN' $* </dev/null"
}

@test "wt-clean --yes reaps a MERGED worktree and deletes its branch" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run_clean "$repo" --yes --no-disk

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo/topic" ]
  run git -C "$repo" branch --list topic
  [ -z "$output" ]
}

@test "wt-clean spares an OPEN PR" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'topic\tOPEN\t7\thttps://example.test/pr/7\tfalse\n'

  run_clean "$repo" --yes --no-disk

  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Nothing to reap"* ]]
}

@test "wt-clean spares a branch with no PR" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'other\tMERGED\t1\thttps://example.test/pr/1\tfalse\n'

  run_clean "$repo" --yes --no-disk

  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Nothing to reap"* ]]
}

@test "wt-clean spares a CLOSED PR unless --include-closed" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'topic\tCLOSED\t9\thttps://example.test/pr/9\tfalse\n'

  run_clean "$repo" --yes --no-disk
  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]

  run_clean "$repo" --include-closed --yes --no-disk
  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo/topic" ]
}

@test "wt-clean blocks a dirty MERGED worktree unless --force" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]
  echo "dirty" >>"$HOME/.trees/repo/topic/base.txt"

  stub_gh 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run_clean "$repo" --yes --no-disk
  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Blocked"* ]]

  run_clean "$repo" --force --yes --no-disk
  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo/topic" ]
}

@test "wt-clean blocks an ahead-of-upstream MERGED worktree unless --force" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local remote="$BATS_TEST_TMPDIR/remote.git"
  make_repo "$repo"
  make_remote_repo "$remote"
  git -C "$repo" remote add origin "$remote"
  git -C "$repo" push -u origin main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  # Push topic to set upstream, then commit locally so it is ahead by one.
  echo "one" >"$HOME/.trees/repo/topic/topic.txt"
  git -C "$HOME/.trees/repo/topic" add topic.txt
  git -C "$HOME/.trees/repo/topic" commit -m "one" >/dev/null
  git -C "$HOME/.trees/repo/topic" push -u origin topic >/dev/null
  echo "two" >>"$HOME/.trees/repo/topic/topic.txt"
  git -C "$HOME/.trees/repo/topic" commit -am "two" >/dev/null

  stub_gh 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run_clean "$repo" --yes --no-disk
  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Blocked"* ]]

  run_clean "$repo" --force --yes --no-disk
  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo/topic" ]
}

@test "wt-clean reaps nothing when gh is unavailable" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  # No gh stub: pr_state degrades to unknown, which is never reap-eligible.
  run_clean "$repo" --yes --no-disk

  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Nothing to reap"* ]]
}

@test "wt-clean --dry-run previews without removing" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run_clean "$repo" --dry-run --no-disk

  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [[ "$output" == *"Dry run"* ]]
}

@test "wt-clean --json emits candidate shape and removes nothing" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  stub_gh 'topic\tMERGED\t42\thttps://example.test/pr/42\tfalse\n'

  run_clean "$repo" --json --no-disk

  [ "$status" -eq 0 ]
  [ -d "$HOME/.trees/repo/topic" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_state')" = "MERGED" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .pr_number')" = "42" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .eligible')" = "true" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch=="topic") | .blocked_reason')" = "null" ]
}
