#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

WT_ADD="$FUNCTIONS_DIR/git/wt-add"
WT_STATUS="$FUNCTIONS_DIR/git/wt-status"
WT_REMOVE="$FUNCTIONS_DIR/git/wt-remove"
WT_FINISH="$FUNCTIONS_DIR/git/wt-finish"
WT_PUBLISH="$FUNCTIONS_DIR/git/wt-publish"
WT_PRUNE="$FUNCTIONS_DIR/git/wt-prune"
WTS="$FUNCTIONS_DIR/git/wts"
WTUI="$FUNCTIONS_DIR/git/wtui"

setup() {
  setup_test_home
}

make_repo() {
  local repo=$1

  git init -b main "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
  echo "base" > "$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -m "initial" >/dev/null
}

make_remote_repo() {
  local remote=$1
  git init --bare "$remote" >/dev/null
}

add_origin_and_push_main() {
  local repo=$1
  local remote=$2

  git -C "$repo" remote add origin "$remote"
  git -C "$repo" push -u origin main >/dev/null
}

@test "wt-status reports locked nested worktrees in json" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --lock feature/foo"
  [ "$status" -eq 0 ]

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq 'length')" -eq 1 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch == "feature/foo") | .locked')" = "true" ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch == "feature/foo") | .path')" = "$HOME/.trees/repo-feature/foo" ]
}

@test "wt-status --all works outside a git repository" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_STATUS' --all --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq 'length')" -eq 1 ]
  [ "$(printf '%s' "$output" | jq -r '.[] | select(.branch == "topic") | .path')" = "$HOME/.trees/repo-topic" ]
}

@test "wts finds nested slash-branch worktrees outside a git repository" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup feature/foo"
  [ "$status" -eq 0 ]

  write_stub fzf <<'EOF'
#!/usr/bin/env bash
head -n 1
EOF

  run zsh -fc "HOME='$HOME'; PATH='$PATH'; fpath=('$FUNCTIONS_DIR/git' \$fpath); autoload -Uz wts; cd /tmp; wts; pwd"

  [ "$status" -eq 0 ]
  [ "$output" = "$HOME/.trees/repo-feature/foo" ]
}

@test "autoloaded wt-add loads shared helpers from the function file path" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  write_stub rs <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  run zsh -fc "fpath=(/home/connor/.config/zsh/functions/git \$fpath); HOME='$HOME'; PATH='$PATH'; cd '$repo'; autoload -Uz wt-add; wt-add --no-setup topic 2>/dev/null"

  [ "$status" -eq 0 ]
  [ "$output" = "$HOME/.trees/repo-topic" ]
  [ -d "$HOME/.trees/repo-topic" ]
}

@test "wt-remove refuses dirty worktrees by default" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "dirty" >> "$HOME/.trees/repo-topic/base.txt"

  run bash -lc "HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_REMOVE' '$HOME/.trees/repo-topic'"

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: worktree has uncommitted changes"* ]]
  [ -d "$HOME/.trees/repo-topic" ]
}

@test "wt-remove works from outside the target repository" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_REMOVE' --delete-branch '$HOME/.trees/repo-topic'"

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo-topic" ]
  run git -C "$repo" branch --list topic
  [ -z "$output" ]
}

@test "wtui prompts before removing a dirty worktree" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local runner="$BATS_TEST_TMPDIR/run-wtui.zsh"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "dirty" >> "$HOME/.trees/repo-topic/base.txt"

  write_stub wt-status <<EOF
#!/usr/bin/env bash
printf '%s\ttopic\t1\t0\t0\t\t0\t0\t0\t0\t0\n' '$HOME/.trees/repo-topic'
EOF

  write_stub fzf <<EOF
#!/usr/bin/env bash
printf 'alt-r\n%s\ttopic\tdirty\t+0/-0\tlock:no\tmerged:no\n' '$HOME/.trees/repo-topic'
EOF

  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
EOF

  cat > "$runner" <<EOF
fpath=('$FUNCTIONS_DIR/git' \$fpath)
autoload -Uz wtui
wtui
EOF

  run bash -lc "export HOME='$HOME' PATH='$PATH' TEST_LOG='$TEST_LOG'; if script --help 2>&1 | grep -q 'illegal option'; then printf 'y\n' | script -q /dev/null zsh --no-rcs -i '$runner'; else printf 'y\n' | script -qec \"zsh --no-rcs -i '$runner'\" /dev/null; fi"

  [ "$status" -eq 0 ]
  grep -q -- "--force $HOME/.trees/repo-topic" "$TEST_LOG"
  [ -d "$HOME/.trees/repo-topic" ]
}

@test "wt-finish local merges back into base and removes the worktree" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "topic" > "$HOME/.trees/repo-topic/topic.txt"
  git -C "$HOME/.trees/repo-topic" add topic.txt
  git -C "$HOME/.trees/repo-topic" commit -m "add topic" >/dev/null

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.base')" = "main" ]
  [ ! -d "$HOME/.trees/repo-topic" ]
  [ -f "$repo/topic.txt" ]
  run git -C "$repo" branch --list topic
  [ -z "$output" ]
}

@test "wt-finish local works when base branch is locally ahead of remote" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local remote="$BATS_TEST_TMPDIR/remote.git"
  make_repo "$repo"

  git init --bare "$remote" >/dev/null
  git -C "$repo" remote add origin "$remote"
  git -C "$repo" push -u origin main >/dev/null

  echo "local-ahead" > "$repo/local.txt"
  git -C "$repo" add local.txt
  git -C "$repo" commit -m "local ahead" >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "topic" > "$HOME/.trees/repo-topic/topic.txt"
  git -C "$HOME/.trees/repo-topic" add topic.txt
  git -C "$HOME/.trees/repo-topic" commit -m "topic change" >/dev/null

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local --json"

  [ "$status" -eq 0 ]
  [ -f "$repo/local.txt" ]
  [ -f "$repo/topic.txt" ]
}

@test "wt-finish local fails fast on dirty worktrees" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "dirty" >> "$HOME/.trees/repo-topic/base.txt"

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local"

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: worktree has uncommitted changes"* ]]
}

@test "wt-finish local unlocks a locked worktree before cleanup" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --lock topic"
  [ "$status" -eq 0 ]

  echo "topic" > "$HOME/.trees/repo-topic/topic.txt"
  git -C "$HOME/.trees/repo-topic" add topic.txt
  git -C "$HOME/.trees/repo-topic" commit -m "add topic" >/dev/null

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local --json"

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo-topic" ]
  [ -f "$repo/topic.txt" ]
}

@test "wt-remove --force removes a locked worktree" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup --lock topic"
  [ "$status" -eq 0 ]

  run bash -lc "cd /tmp && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_REMOVE' --force --delete-branch '$HOME/.trees/repo-topic'"

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.trees/repo-topic" ]
  run git -C "$repo" branch --list topic
  [ -z "$output" ]
}

@test "wt-publish pushes the branch and creates a PR via gh" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local remote="$BATS_TEST_TMPDIR/remote.git"
  make_repo "$repo"
  make_remote_repo "$remote"
  add_origin_and_push_main "$repo" "$remote"

  write_stub gh <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "https://example.test/pr/123"
  exit 0
fi
exit 1
EOF

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "topic" > "$HOME/.trees/repo-topic/topic.txt"
  git -C "$HOME/.trees/repo-topic" add topic.txt
  git -C "$HOME/.trees/repo-topic" commit -m "add topic" >/dev/null

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' TEST_LOG='$TEST_LOG' PATH='$PATH' zsh --no-rcs '$WT_PUBLISH' --pr --json"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.remote')" = "origin" ]
  [ "$(printf '%s' "$output" | jq -r '.pr_url')" = "https://example.test/pr/123" ]
  [ "$(git -C "$HOME/.trees/repo-topic" rev-parse --abbrev-ref --symbolic-full-name '@{u}')" = "origin/topic" ]
  grep -q "pr create --base main --head topic --fill" "$TEST_LOG"
}

@test "wt-add prefers origin when multiple remotes have the same branch" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local origin="$BATS_TEST_TMPDIR/origin.git"
  local other="$BATS_TEST_TMPDIR/other.git"
  local origin_seed="$BATS_TEST_TMPDIR/origin-seed"
  local other_seed="$BATS_TEST_TMPDIR/other-seed"
  make_repo "$repo"

  git init --bare "$origin" >/dev/null
  git init --bare "$other" >/dev/null
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push -u origin main >/dev/null

  git clone "$origin" "$origin_seed" >/dev/null
  git -C "$origin_seed" config user.name "Bats"
  git -C "$origin_seed" config user.email "bats@example.com"
  git -C "$origin_seed" checkout -b topic >/dev/null
  echo "from-origin" > "$origin_seed/origin.txt"
  git -C "$origin_seed" add origin.txt
  git -C "$origin_seed" commit -m "origin topic" >/dev/null
  git -C "$origin_seed" push -u origin topic >/dev/null

  git clone "$other" "$other_seed" >/dev/null
  git -C "$other_seed" config user.name "Bats"
  git -C "$other_seed" config user.email "bats@example.com"
  echo "base" > "$other_seed/base.txt"
  git -C "$other_seed" add base.txt
  git -C "$other_seed" commit -m "initial" >/dev/null
  git -C "$other_seed" push -u origin HEAD:main >/dev/null
  git -C "$other_seed" checkout -b topic >/dev/null
  echo "from-other" > "$other_seed/other.txt"
  git -C "$other_seed" add other.txt
  git -C "$other_seed" commit -m "other topic" >/dev/null
  git -C "$other_seed" push -u origin topic >/dev/null

  git -C "$repo" remote add aaa "$other"
  git -C "$repo" fetch origin >/dev/null
  git -C "$repo" fetch aaa >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo-topic/origin.txt" ]
  [ ! -f "$HOME/.trees/repo-topic/other.txt" ]
  [ "$(git -C "$HOME/.trees/repo-topic" rev-parse --abbrev-ref --symbolic-full-name '@{u}')" = "origin/topic" ]
}

@test "wt-add falls back from upstream main to origin feature branch" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local upstream="$BATS_TEST_TMPDIR/upstream.git"
  local origin="$BATS_TEST_TMPDIR/origin.git"
  local upstream_seed="$BATS_TEST_TMPDIR/upstream-seed"
  local origin_seed="$BATS_TEST_TMPDIR/origin-seed"
  make_repo "$repo"

  git init --bare "$upstream" >/dev/null
  git init --bare "$origin" >/dev/null
  git -C "$repo" remote add upstream "$upstream"
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push upstream main >/dev/null

  git clone "$upstream" "$upstream_seed" >/dev/null
  git -C "$upstream_seed" config user.name "Bats"
  git -C "$upstream_seed" config user.email "bats@example.com"
  echo "upstream-main" > "$upstream_seed/upstream.txt"
  git -C "$upstream_seed" add upstream.txt
  git -C "$upstream_seed" commit -m "upstream main" >/dev/null
  git -C "$upstream_seed" push origin HEAD:main >/dev/null

  git clone "$upstream" "$origin_seed" >/dev/null
  git -C "$origin_seed" remote set-url origin "$origin"
  git -C "$origin_seed" config user.name "Bats"
  git -C "$origin_seed" config user.email "bats@example.com"
  git -C "$origin_seed" push -u origin main >/dev/null
  git -C "$origin_seed" checkout -b topic >/dev/null
  echo "origin-topic" > "$origin_seed/topic.txt"
  git -C "$origin_seed" add topic.txt
  git -C "$origin_seed" commit -m "origin topic" >/dev/null
  git -C "$origin_seed" push -u origin topic >/dev/null

  git -C "$repo" fetch upstream >/dev/null
  git -C "$repo" fetch origin >/dev/null
  git -C "$repo" branch --set-upstream-to=upstream/main main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo-topic/topic.txt" ]
  [ "$(git -C "$HOME/.trees/repo-topic" rev-parse --abbrev-ref --symbolic-full-name '@{u}')" = "origin/topic" ]
}

@test "wt-add fetches origin before falling back from upstream-tracked main" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local upstream="$BATS_TEST_TMPDIR/upstream.git"
  local origin="$BATS_TEST_TMPDIR/origin.git"
  local upstream_seed="$BATS_TEST_TMPDIR/upstream-seed"
  local origin_seed="$BATS_TEST_TMPDIR/origin-seed"
  make_repo "$repo"

  git init --bare "$upstream" >/dev/null
  git init --bare "$origin" >/dev/null
  git -C "$repo" remote add upstream "$upstream"
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push upstream main >/dev/null

  git clone "$upstream" "$upstream_seed" >/dev/null
  git -C "$upstream_seed" config user.name "Bats"
  git -C "$upstream_seed" config user.email "bats@example.com"
  git -C "$upstream_seed" push origin HEAD:main >/dev/null

  git clone "$upstream" "$origin_seed" >/dev/null
  git -C "$origin_seed" remote set-url origin "$origin"
  git -C "$origin_seed" config user.name "Bats"
  git -C "$origin_seed" config user.email "bats@example.com"
  git -C "$origin_seed" push -u origin main >/dev/null
  git -C "$origin_seed" checkout -b topic >/dev/null
  echo "fetched-late" > "$origin_seed/topic.txt"
  git -C "$origin_seed" add topic.txt
  git -C "$origin_seed" commit -m "origin topic" >/dev/null
  git -C "$origin_seed" push -u origin topic >/dev/null

  git -C "$repo" fetch upstream >/dev/null
  git -C "$repo" branch --set-upstream-to=upstream/main main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.trees/repo-topic/topic.txt" ]
  [ "$(git -C "$HOME/.trees/repo-topic" rev-parse --abbrev-ref --symbolic-full-name '@{u}')" = "origin/topic" ]
}

@test "wt-finish syncs base branch from base remote, not feature remote" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local upstream="$BATS_TEST_TMPDIR/upstream.git"
  local origin="$BATS_TEST_TMPDIR/origin.git"
  local upstream_seed="$BATS_TEST_TMPDIR/upstream-seed"
  local origin_seed="$BATS_TEST_TMPDIR/origin-seed"
  make_repo "$repo"

  git init --bare "$upstream" >/dev/null
  git init --bare "$origin" >/dev/null
  git -C "$repo" remote add upstream "$upstream"
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push upstream main >/dev/null

  git clone "$upstream" "$upstream_seed" >/dev/null
  git -C "$upstream_seed" config user.name "Bats"
  git -C "$upstream_seed" config user.email "bats@example.com"
  echo "base-update" > "$upstream_seed/upstream.txt"
  git -C "$upstream_seed" add upstream.txt
  git -C "$upstream_seed" commit -m "upstream main update" >/dev/null
  git -C "$upstream_seed" push origin HEAD:main >/dev/null

  git clone "$upstream" "$origin_seed" >/dev/null
  git -C "$origin_seed" remote set-url origin "$origin"
  git -C "$origin_seed" config user.name "Bats"
  git -C "$origin_seed" config user.email "bats@example.com"
  git -C "$origin_seed" push -u origin main >/dev/null
  git -C "$origin_seed" checkout -b topic >/dev/null
  echo "feature" > "$origin_seed/topic.txt"
  git -C "$origin_seed" add topic.txt
  git -C "$origin_seed" commit -m "topic feature" >/dev/null
  git -C "$origin_seed" push -u origin topic >/dev/null

  git -C "$repo" fetch upstream >/dev/null
  git -C "$repo" fetch origin >/dev/null
  git -C "$repo" merge --ff-only upstream/main >/dev/null
  git -C "$repo" branch --set-upstream-to=upstream/main main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local --json"

  [ "$status" -eq 0 ]
  [ -f "$repo/upstream.txt" ]
  [ -f "$repo/topic.txt" ]
  [ ! -d "$HOME/.trees/repo-topic" ]
}

@test "wt-finish --delete-remote deletes the feature branch without explicit --remote" {
  local repo="$BATS_TEST_TMPDIR/repo"
  local remote="$BATS_TEST_TMPDIR/remote.git"
  make_repo "$repo"

  git init --bare "$remote" >/dev/null
  git -C "$repo" remote add origin "$remote"
  git -C "$repo" push -u origin main >/dev/null

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  echo "topic" > "$HOME/.trees/repo-topic/topic.txt"
  git -C "$HOME/.trees/repo-topic" add topic.txt
  git -C "$HOME/.trees/repo-topic" commit -m "add topic" >/dev/null
  git -C "$HOME/.trees/repo-topic" push -u origin topic >/dev/null

  run bash -lc "cd '$HOME/.trees/repo-topic' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_FINISH' --mode local --delete-remote --json"

  [ "$status" -eq 0 ]
  ! git -C "$repo" ls-remote --exit-code --heads origin topic >/dev/null 2>&1
}

@test "wt-prune removes stale worktree metadata" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_ADD' --no-setup topic"
  [ "$status" -eq 0 ]

  rm -rf "$HOME/.trees/repo-topic"

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' zsh --no-rcs '$WT_PRUNE' --json"

  [ "$status" -eq 0 ]
  [[ "$output" == *"repo-topic"* ]]
}
