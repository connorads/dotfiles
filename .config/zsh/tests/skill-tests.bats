#!/usr/bin/env bats

# The dhk wrapper and the pre-commit hook export GIT_DIR/GIT_WORK_TREE for the
# dotfiles bare-repo layout, and hk hands that environment to every step.
# skill-tests.sh is the only step that executes arbitrary test code, so it is the
# only place a suite's bare `git` can reach the real dotfiles repo. It has done:
# skills/hk/tests/soft-protected-branch-pre-push.bats repointed ~/git/dotfiles
# HEAD at a branch that does not exist. These tests pin the harness-level
# defence, so no present or future suite can inherit that environment.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SCRIPT="$(cd "$TESTS_DIR/../../.." && pwd)/.hk-hooks/skill-tests.sh"

# setup_test_home rebuilds $PATH from the system and nix dirs, which carry no
# mise shim dir: without putting bats back, skill-tests.sh would warn-and-skip
# and every test here would pass having run nothing.
#
# It must be bin/bats, not `command -v bats`: bats prepends its own libexec dir
# to $PATH, so inside a test that name resolves to libexec/bats-core/bats, the
# inner entry point. That one needs the bats_readlinkf function bin/bats exports,
# which does not survive the parallel runner, so a nested run dies under -j.
BATS_BIN_DIR="${BATS_ROOT:-}/bin"
[ -x "$BATS_BIN_DIR/bats" ] || BATS_BIN_DIR="$(dirname "$(command -v bats)")"

setup() {
  setup_test_home
  export PATH="$PATH:$BATS_BIN_DIR"

  # Stands in for ~/git/dotfiles: a bare repo plus work-tree. Built first, then
  # exported exactly as dhk and .hk-hooks/pre-commit do - `git init --bare`
  # rejects an inherited GIT_WORK_TREE.
  FAKE_GIT_DIR="$BATS_TEST_TMPDIR/fake.git"
  FAKE_WORK_TREE="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$FAKE_WORK_TREE"
  git init -q --bare "$FAKE_GIT_DIR"
  git --git-dir="$FAKE_GIT_DIR" symbolic-ref HEAD refs/heads/master
  export GIT_DIR="$FAKE_GIT_DIR"
  export GIT_WORK_TREE="$FAKE_WORK_TREE"

  # A single planted skill, so `skill-tests.sh --all` finds exactly one suite.
  PROBE_DIR="$HOME/skills/probe/tests"
  mkdir -p "$PROBE_DIR"

  # Proof the suite actually ran: without it, a skipped or unfound suite would
  # satisfy every assertion below.
  export PROBE_MARKER="$BATS_TEST_TMPDIR/probe-ran"
}

@test "test suites do not inherit the dotfiles GIT_DIR/GIT_WORK_TREE" {
  cat >"$PROBE_DIR/probe.bats" <<'EOF'
#!/usr/bin/env bats
@test "probe: git environment is stripped" {
  printf 'ran\n' >"$PROBE_MARKER"
  [ -z "${GIT_DIR:-}" ]
  [ -z "${GIT_WORK_TREE:-}" ]
}
EOF

  run bash "$SCRIPT" --all

  [ -f "$PROBE_MARKER" ]
  [ "$status" -eq 0 ]
}

@test "a suite's mutating git calls cannot reach the dotfiles repo" {
  # The real offending calls from soft-protected-branch-pre-push.bats, in the
  # same shape: a temp repo created and cd'd into, then bare `git` mutations.
  cat >"$PROBE_DIR/probe.bats" <<'EOF'
#!/usr/bin/env bats
setup() {
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q "$REPO"
  cd "$REPO"
}
@test "probe: mutations land in the probe's own fixture" {
  printf 'ran\n' >"$PROBE_MARKER"
  git symbolic-ref HEAD refs/heads/main
  git config --local hooks.allowMainPush false
}
EOF

  run bash "$SCRIPT" --all

  [ -f "$PROBE_MARKER" ]
  [ "$(cat "$GIT_DIR/HEAD")" = "ref: refs/heads/master" ]
  run git --git-dir="$GIT_DIR" config --get hooks.allowMainPush
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}
