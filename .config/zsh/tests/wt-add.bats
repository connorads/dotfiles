#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_ADD="$FUNCTIONS_DIR/git/wt-add"

setup() {
  setup_test_home

  write_stub rs <<'EOF'
#!/usr/bin/env bash
pwd > "$TEST_LOG"
EOF
}

make_repo() {
  local repo=$1

  git init "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" > "$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null
}

@test "errors outside a git repository" {
  run_zsh_function "$WT_ADD" topic

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: not in a git repository"* ]]
}

@test "returns the existing worktree path without running setup" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  mkdir -p "$HOME/.trees/repo-topic"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo-topic"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "adds a local branch worktree and runs setup in the new worktree" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" branch topic >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo-topic"* ]]
  [ -e "$HOME/.trees/repo-topic/.git" ]
  [ "$(cat "$TEST_LOG")" = "$HOME/.trees/repo-topic" ]
}

@test "creates a new branch from an explicit base and skips setup with --no-setup" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" checkout -b base-branch >/dev/null
  echo "base branch" > "$repo/branch.txt"
  git -C "$repo" add branch.txt
  git -C "$repo" commit -m "base branch" >/dev/null
  git -C "$repo" checkout master >/dev/null 2>&1 || git -C "$repo" checkout main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --base base-branch feature"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo-feature"* ]]
  [ -f "$HOME/.trees/repo-feature/branch.txt" ]
  [ ! -s "$TEST_LOG" ]
}
