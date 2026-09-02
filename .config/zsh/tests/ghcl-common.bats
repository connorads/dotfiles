#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# The two pure helpers ghcl and ghcl-org share. Naming the lib file here is what
# makes the `bats-scoped` hk gate (a `grep -rlw` on the staged file's stem) run
# this suite for a commit touching only `_ghcl-common`.
GHCL_COMMON="$FUNCTIONS_DIR/git/_ghcl-common"

setup() {
  setup_test_home
}

# Each case runs the helper in a fresh non-rc zsh, so nothing but the lib is in
# scope - the same way ghcl-org's plan phase calls it.
call() {
  run zsh --no-rcs -c "source '$GHCL_COMMON'; $*"
}

@test "shorthand becomes an SSH url" {
  call "_ghcl_ssh_url owner/name"

  [ "$status" -eq 0 ]
  [ "$output" = "git@github.com:owner/name.git" ]
}

@test "shorthand with a .git suffix is not doubled" {
  call "_ghcl_ssh_url owner/name.git"

  [ "$status" -eq 0 ]
  [ "$output" = "git@github.com:owner/name.git" ]
}

@test "a full HTTPS url passes through untouched" {
  call "_ghcl_ssh_url https://github.com/owner/name.git"

  [ "$status" -eq 0 ]
  [ "$output" = "https://github.com/owner/name.git" ]
}

@test "a full SSH url passes through untouched" {
  call "_ghcl_ssh_url git@github.com:owner/name.git"

  [ "$status" -eq 0 ]
  [ "$output" = "git@github.com:owner/name.git" ]
}

@test "repo dir is the clone target git would create" {
  call "_ghcl_repo_dir git@github.com:owner/name.git"

  [ "$status" -eq 0 ]
  [ "$output" = "name" ]
}

@test "repo dir strips the path from an HTTPS url" {
  call "_ghcl_repo_dir https://github.com/owner/name.git"

  [ "$status" -eq 0 ]
  [ "$output" = "name" ]
}

@test "repo dir handles a url with no .git suffix" {
  call "_ghcl_repo_dir https://github.com/owner/name"

  [ "$status" -eq 0 ]
  [ "$output" = "name" ]
}
