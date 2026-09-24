#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

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
  echo "base" >"$repo/base.txt"
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
  git -C "$repo" worktree add "$HOME/.trees/repo/topic" -b topic >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo/topic"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "adds a local branch worktree and runs setup in the new worktree" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" branch topic >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo/topic"* ]]
  [ -e "$HOME/.trees/repo/topic/.git" ]
  [ "$(cat "$TEST_LOG")" = "$HOME/.trees/repo/topic" ]
}

@test "creates a new branch from an explicit base and skips setup with --no-setup" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" checkout -b base-branch >/dev/null
  echo "base branch" >"$repo/branch.txt"
  git -C "$repo" add branch.txt
  git -C "$repo" commit -m "base branch" >/dev/null
  git -C "$repo" checkout master >/dev/null 2>&1 || git -C "$repo" checkout main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --base base-branch feature"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo/feature"* ]]
  [ -f "$HOME/.trees/repo/feature/branch.txt" ]
  [ ! -s "$TEST_LOG" ]
}

@test "--no-fetch skips remote fetch and still checks out a local branch" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" branch topic >/dev/null
  # A remote that would fail loudly if contacted: the fetch block warns on
  # failure, so any contact shows up in output.
  git -C "$repo" remote add origin "$BATS_TEST_TMPDIR/no-such-remote.git"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --no-fetch topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo/topic"* ]]
  [[ "$output" != *"fetch failed"* ]]
  [ -e "$HOME/.trees/repo/topic/.git" ]
}

@test "without --no-fetch an unreachable remote is contacted and warned about" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" branch topic >/dev/null
  git -C "$repo" remote add origin "$BATS_TEST_TMPDIR/no-such-remote.git"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic 2>&1"

  [ "$status" -eq 0 ]
  [[ "$output" == *"fetch failed"* ]]
}

@test "supports slash branch names and json output" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --json feature/foo 2>/dev/null"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.branch')" = "feature/foo" ]
  [ "$(printf '%s' "$output" | jq -r '.path')" = "$HOME/.trees/repo/feature/foo" ]
  [ -d "$HOME/.trees/repo/feature/foo" ]
}

# A repo on `main` whose checkout sits on a feature branch one commit ahead.
make_repo_on_feature() {
  local repo=$1

  git init -b main "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null
  git -C "$repo" checkout -b feature >/dev/null 2>&1
  echo "feature" >"$repo/feature.txt"
  git -C "$repo" add feature.txt
  git -C "$repo" commit -m "feature" >/dev/null
}

@test "without --base a new branch starts from the default branch, not HEAD" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo_on_feature "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo/topic/base.txt" ]
  [ ! -e "$HOME/.trees/repo/topic/feature.txt" ]
}

@test "without --base a new branch starts from the fetched origin default branch, untracked" {
  local origin="$BATS_TEST_TMPDIR/origin"
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo_on_feature "$origin"
  git -C "$origin" checkout main >/dev/null 2>&1
  git clone "$origin" "$repo" >/dev/null 2>&1
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  git -C "$repo" checkout feature >/dev/null 2>&1
  echo "upstream" >"$origin/upstream.txt"
  git -C "$origin" add upstream.txt
  git -C "$origin" commit -m "upstream" >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo/topic/upstream.txt" ]
  [ ! -e "$HOME/.trees/repo/topic/feature.txt" ]
  run git -C "$HOME/.trees/repo/topic" rev-parse --abbrev-ref '@{u}'
  [ "$status" -ne 0 ]
}

@test "--base HEAD branches from the checked-out branch" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo_on_feature "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --base HEAD topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo/topic/feature.txt" ]
}

@test "errors naming --base when no default branch resolves" {
  local repo="$BATS_TEST_TMPDIR/repo"
  git init -b trunk "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic 2>&1"

  [ "$status" -eq 1 ]
  [[ "$output" == *"--base"* ]]
  [ ! -e "$HOME/.trees/repo/topic" ]
}

@test "from inside a linked worktree names the tree dir after the main repo" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git -C "$repo" worktree add "$HOME/.trees/repo/topic" -b topic >/dev/null

  run bash -lc "cd '$HOME/.trees/repo/topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup other"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/repo/other"* ]]
  [ -e "$HOME/.trees/repo/other/.git" ]
}

@test "from a linked worktree of a bare repo strips the .git suffix" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  git clone --bare "$repo" "$BATS_TEST_TMPDIR/proj.git" >/dev/null 2>&1
  git -C "$BATS_TEST_TMPDIR/proj.git" worktree add "$HOME/.trees/proj/topic" -b topic >/dev/null 2>&1

  run bash -lc "cd '$HOME/.trees/proj/topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --no-fetch other"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/proj/other"* ]]
}

@test "a separate-git-dir main checkout keeps its toplevel name" {
  local checkout="$BATS_TEST_TMPDIR/checkout"
  git init --separate-git-dir "$BATS_TEST_TMPDIR/meta.git" "$checkout" >/dev/null
  git -C "$checkout" config user.name "Bats"
  git -C "$checkout" config user.email "bats@example.com"
  echo "base" >"$checkout/base.txt"
  git -C "$checkout" add base.txt
  git -C "$checkout" commit -m "initial" >/dev/null

  run bash -lc "cd '$checkout' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.trees/checkout/topic"* ]]
}
