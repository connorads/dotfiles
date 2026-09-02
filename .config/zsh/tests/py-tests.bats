#!/usr/bin/env bats

# .hk-hooks/py-tests.sh is the Python half of the commit-time test gate (the
# sibling of ts-tests.sh). These tests pin its harness invariants, not pytest's
# behaviour: which project a staged file resolves to, that every gate runs
# inside that project's own uv env with the config source pinned, that the
# optional gates run only when the pyproject declares them, that the dotfiles
# git environment is stripped before any suite runs, and that the never-brick
# skip really is a skip (exit 0 having run nothing) rather than a false green.
#
# uv is a stub planted in $TEST_BIN that records every invocation; the real uv
# is mise-installed and absent from the PATH setup_test_home builds.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SCRIPT="$(cd "$TESTS_DIR/../../.." && pwd)/.hk-hooks/py-tests.sh"

setup() {
  setup_test_home

  export RUNNER_LOG="$BATS_TEST_TMPDIR/runners.log"
  : >"$RUNNER_LOG"

  # Exported exactly as dhk and .hk-hooks/pre-commit do, so the strip is under
  # test rather than assumed.
  FAKE_GIT_DIR="$BATS_TEST_TMPDIR/fake.git"
  FAKE_WORK_TREE="$BATS_TEST_TMPDIR/wt"
  mkdir -p "$FAKE_WORK_TREE"
  git init -q --bare "$FAKE_GIT_DIR"
  export GIT_DIR="$FAKE_GIT_DIR"
  export GIT_WORK_TREE="$FAKE_WORK_TREE"
}

# write_uv_stub - records argv, cwd and inherited git environment, then exits
# with UV_EXIT (default 0). `--version` answers successfully and is NOT logged:
# the gate probes runnability that way before dispatching, so the probe is
# harness, not a gate invocation. UV_FAIL_ON names an argv substring that alone
# should exit 1, so one failing gate can be distinguished from the rest.
write_uv_stub() {
  write_stub uv <<'EOF'
#!/usr/bin/env bash
if [ "$1" = --version ]; then
  echo "uv 0.0.0-stub"
  exit 0
fi
printf 'uv %s cwd=%s GIT_DIR=[%s] GIT_WORK_TREE=[%s]\n' \
  "$*" "${PWD#$HOME/}" "${GIT_DIR:-}" "${GIT_WORK_TREE:-}" >>"$RUNNER_LOG"
if [ -n "${UV_FAIL_ON:-}" ] && [[ "$*" == *"$UV_FAIL_ON"* ]]; then
  exit 1
fi
exit "${UV_EXIT:-0}"
EOF
}

# make_project DIR [SECTIONS...] - a project the script can discover. Extra
# arguments are pyproject section names to declare (importlinter, deptry).
make_project() {
  local dir="$HOME/$1"
  shift
  mkdir -p "$dir/src/pkg" "$dir/tests"
  printf '[project]\nname = "pkg"\nversion = "0"\n' >"$dir/pyproject.toml"
  local section
  for section in "$@"; do
    printf '\n[tool.%s]\n' "$section" >>"$dir/pyproject.toml"
  done
}

@test "the suite runs in the project's own uv env with the config source pinned" {
  write_uv_stub
  make_project src/handoff

  run bash "$SCRIPT" src/handoff/src/pkg/ir.py

  [ "$status" -eq 0 ]
  [[ "$(cat "$RUNNER_LOG")" == *"uv run --group dev pytest -c pyproject.toml cwd=src/handoff"* ]]
}

@test "test suites do not inherit the dotfiles GIT_DIR/GIT_WORK_TREE" {
  write_uv_stub
  make_project src/handoff

  run bash "$SCRIPT" src/handoff/src/pkg/ir.py

  [ "$status" -eq 0 ]
  [[ "$(cat "$RUNNER_LOG")" == *"GIT_DIR=[] GIT_WORK_TREE=[]"* ]]
}

@test "a staged file resolves to its nearest pyproject.toml, not an ancestor's" {
  write_uv_stub
  make_project src/mono
  make_project src/mono/inner

  run bash "$SCRIPT" src/mono/inner/src/pkg/x.py

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 1 ]
  [[ "$(cat "$RUNNER_LOG")" == *"cwd=src/mono/inner"* ]]
}

@test "lint-imports and deptry run only when the pyproject declares them" {
  write_uv_stub
  make_project src/plain
  make_project src/gated importlinter deptry

  run bash "$SCRIPT" src/plain/src/pkg/a.py src/gated/src/pkg/b.py

  [ "$status" -eq 0 ]
  [ "$(grep -c 'pytest' "$RUNNER_LOG")" -eq 2 ]
  [ "$(grep -c 'lint-imports --no-cache cwd=src/gated' "$RUNNER_LOG")" -eq 1 ]
  [ "$(grep -c 'deptry src cwd=src/gated' "$RUNNER_LOG")" -eq 1 ]
  [ "$(grep -c 'cwd=src/plain' "$RUNNER_LOG")" -eq 1 ]
}

@test "a failing gate fails the step, and one failure doesn't mask the others" {
  write_uv_stub
  export UV_FAIL_ON="lint-imports"
  make_project src/gated importlinter deptry

  run bash "$SCRIPT" src/gated/src/pkg/b.py

  [ "$status" -eq 1 ]
  # pytest, lint-imports and deptry all ran despite the middle one failing.
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 3 ]
}

@test "an absent uv skips rather than failing" {
  make_project src/handoff

  run bash "$SCRIPT" src/handoff/src/pkg/ir.py

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
  [[ "$output" == *"uv absent"* ]]
}

# Resolving is not running: a mise shim resolves on PATH where no version is
# set and then exits 1. Guarding on the name alone would turn this skip into a
# hard commit failure.
@test "a uv whose shim resolves but cannot run skips rather than failing" {
  write_stub uv <<'EOF'
#!/usr/bin/env bash
echo "mise ERROR No version is set for shim: uv" >&2
exit 1
EOF
  make_project src/handoff

  run bash "$SCRIPT" src/handoff/src/pkg/ir.py

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
  [[ "$output" == *"uv absent"* ]]
}

@test "a staged file outside any project runs nothing" {
  write_uv_stub
  make_project src/handoff

  run bash "$SCRIPT" .hk-hooks/gate-coverage.py

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
}

@test "--all discovers every project under the roots and never a .venv" {
  write_uv_stub
  make_project src/handoff
  mkdir -p "$HOME/src/handoff/.venv/lib/dep"
  printf '[project]\nname = "dep"\n' >"$HOME/src/handoff/.venv/lib/dep/pyproject.toml"

  run bash "$SCRIPT" --all

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 1 ]
  [[ "$(cat "$RUNNER_LOG")" == *"cwd=src/handoff GIT"* ]]
}
