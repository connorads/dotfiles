#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

DHK="$FUNCTIONS_DIR/dhk"

setup() {
  setup_test_home
  mkdir -p "$HOME/git/dotfiles"

  write_stub hk <<'EOF'
#!/usr/bin/env bash
{
  printf 'PWD=%s\n' "$PWD"
  printf 'GIT_DIR=%s\n' "${GIT_DIR:-}"
  printf 'GIT_WORK_TREE=%s\n' "${GIT_WORK_TREE:-}"
  printf 'HK_STASH_UNTRACKED=%s\n' "${HK_STASH_UNTRACKED:-}"
  printf 'args=%s\n' "$*"
} >>"$TEST_LOG"
EOF
}

@test "dhk runs hk from HOME with explicit dotfiles git environment" {
  run_zsh_function "$DHK" check

  [ "$status" -eq 0 ]
  grep -Fxq "PWD=$HOME" "$TEST_LOG"
  grep -Fxq "GIT_DIR=$HOME/git/dotfiles" "$TEST_LOG"
  grep -Fxq "GIT_WORK_TREE=$HOME" "$TEST_LOG"
  grep -Fxq "HK_STASH_UNTRACKED=false" "$TEST_LOG"
  grep -Fxq "args=check" "$TEST_LOG"
}

# `hk test` runs each step's tests {} block, and a test's `before` runs bare
# `git` - Builtins.actionlint's is `git init`. GIT_DIR beats cwd discovery, so
# running in a sandbox dir is no defence: with the split exported that command
# re-initialises ~/git/dotfiles and rewrites its config. It only failed to
# because a commit in progress happened to hold the config lock.
@test "dhk test runs hk with no dotfiles git environment to leak" {
  run_zsh_function "$DHK" test

  [ "$status" -eq 0 ]
  grep -Fxq "PWD=$HOME" "$TEST_LOG"
  grep -Fxq "GIT_DIR=" "$TEST_LOG"
  grep -Fxq "GIT_WORK_TREE=" "$TEST_LOG"
  grep -Fxq "args=test" "$TEST_LOG"
}

# The strip is scoped to `test`; everything else still needs the split to
# address the bare repo at all.
@test "a subcommand merely starting with test still gets the git environment" {
  run_zsh_function "$DHK" check --step test-only

  [ "$status" -eq 0 ]
  grep -Fxq "GIT_DIR=$HOME/git/dotfiles" "$TEST_LOG"
}
