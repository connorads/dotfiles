#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

GHCL="$FUNCTIONS_DIR/git/ghcl"

setup() {
  setup_test_home
  export GIT_LOG="$BATS_TEST_TMPDIR/git.log"
  export GH_LOG="$BATS_TEST_TMPDIR/gh.log"
  : >"$GIT_LOG"
  : >"$GH_LOG"

  # git stub: log argv and materialise the clone target dir (cwd-relative)
  write_stub git <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'git'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GIT_LOG"

if [ "${1:-}" = clone ]; then
  url="${!#}"
  dir="${url##*/}"
  dir="${dir%.git}"
  mkdir -p "$dir"
fi
exit 0
EOF

  # gh stub: must never be reached on the direct-clone path
  write_stub gh <<'EOF'
#!/usr/bin/env bash
{
  printf 'gh'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$GH_LOG"
echo "ghcl: gh should not be called: $*" >&2
exit 99
EOF
}

@test "shorthand clones via git+SSH without invoking gh" {
  run_zsh_function "$GHCL" -n owner/name

  [ "$status" -eq 0 ]
  grep -Fq 'git <clone> <git@github.com:owner/name.git>' "$GIT_LOG"
  [ ! -s "$GH_LOG" ]
}

@test ".git suffix is normalised in the SSH url" {
  run_zsh_function "$GHCL" -n owner/name.git

  [ "$status" -eq 0 ]
  grep -Fq 'git <clone> <git@github.com:owner/name.git>' "$GIT_LOG"
  [ ! -s "$GH_LOG" ]
}

@test "full HTTPS url is cloned verbatim" {
  run_zsh_function "$GHCL" -n https://github.com/owner/name.git

  [ "$status" -eq 0 ]
  grep -Fq 'git <clone> <https://github.com/owner/name.git>' "$GIT_LOG"
  [ ! -s "$GH_LOG" ]
}

@test "full SSH/scp url is cloned verbatim" {
  run_zsh_function "$GHCL" -n git@github.com:owner/name.git

  [ "$status" -eq 0 ]
  grep -Fq 'git <clone> <git@github.com:owner/name.git>' "$GIT_LOG"
  [ ! -s "$GH_LOG" ]
}

@test "cd lands in the repo dir for a shorthand arg" {
  local start="$BATS_TEST_TMPDIR/start"
  mkdir -p "$start"

  run zsh -fc "fpath=('$FUNCTIONS_DIR/git' \$fpath); autoload -Uz ghcl; cd '$start'; ghcl owner/name; pwd"

  [ "$status" -eq 0 ]
  [[ "$output" == *"/name" ]]
}

@test "cd lands in the repo dir for a url arg" {
  local start="$BATS_TEST_TMPDIR/start"
  mkdir -p "$start"

  run zsh -fc "fpath=('$FUNCTIONS_DIR/git' \$fpath); autoload -Uz ghcl; cd '$start'; ghcl https://github.com/owner/name.git; pwd"

  [ "$status" -eq 0 ]
  [[ "$output" == *"/name" ]]
}

@test "--no-cd stays in the starting directory" {
  local start="$BATS_TEST_TMPDIR/start"
  mkdir -p "$start"

  run zsh -fc "fpath=('$FUNCTIONS_DIR/git' \$fpath); autoload -Uz ghcl; cd '$start'; ghcl -n owner/name; pwd"

  [ "$status" -eq 0 ]
  [ "$output" = "$start" ]
}

@test "--help prints usage without cloning" {
  run_zsh_function "$GHCL" --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: ghcl"* ]]
  [ ! -s "$GIT_LOG" ]
  [ ! -s "$GH_LOG" ]
}

@test "unknown option errors before cloning" {
  run_zsh_function "$GHCL" --bogus

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown option: --bogus"* ]]
  [ ! -s "$GIT_LOG" ]
  [ ! -s "$GH_LOG" ]
}
