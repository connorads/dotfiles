#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

RS="$FUNCTIONS_DIR/rs"

setup() {
  setup_test_home
}

make_repo() {
  local repo=$1

  git init -b main "$repo" >/dev/null
  git -C "$repo" config user.name "Bats"
  git -C "$repo" config user.email "bats@example.com"
}

run_rs() {
  local repo=$1

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' TEST_LOG='$TEST_LOG' CI='' zsh --no-rcs '$RS'"
}

@test "rs reports hook state and still finishes in a repo with no lockfiles" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  write_stub git-hooks <<'EOF'
#!/usr/bin/env bash
printf 'git-hooks %s\n' "$*" >>"$TEST_LOG"
echo "hooks: husky - declared, not armed"
EOF

  run_rs "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"hooks: husky - declared, not armed"* ]]
  [[ "$output" == *"=> done"* ]]
  # `git hooks status` dispatches to the git-hooks on PATH, dropping the
  # subcommand word - so the stub sees exactly "status --quiet".
  grep -q 'git-hooks status --quiet' "$TEST_LOG"
}

@test "rs finishes when git-hooks is absent from PATH" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"

  # No git-hooks stub: the sanitised test PATH has none, so `command -v` fails
  # and the step degrades to nothing rather than failing repo setup.
  run_rs "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"=> done"* ]]
  [[ "$output" != *"hooks:"* ]]
}
