#!/usr/bin/env bats

# .hk-hooks/ts-tests.sh is the TS half of the commit-time test gate. These tests
# pin its load-bearing harness invariants, not the runners' behaviour: which
# project a staged file resolves to, which package manager is dispatched, that
# the dotfiles git environment is stripped before any suite runs, and that every
# never-brick skip really is a skip (exit 0 having run nothing) rather than a
# false green.
#
# bun/pnpm are stubs planted in $TEST_BIN. Every real runner is mise-installed
# and so absent from the PATH setup_test_home builds - and what is under test is
# the script's dispatch decisions, not bun's. A marker log proves a suite ran;
# without one, a warn-and-skip satisfies every naive assertion here.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SCRIPT="$(cd "$TESTS_DIR/../../.." && pwd)/.hk-hooks/ts-tests.sh"

setup() {
  setup_test_home

  # The script warns and exits 0 without jq, which would make every assertion
  # below pass vacuously.
  command -v jq >/dev/null 2>&1 || skip "jq absent"

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

# write_runner_stub NAME - records its argv, cwd and inherited git environment,
# then exits with ${NAME}_EXIT (default 0).
write_runner_stub() {
  local name=$1 upper
  upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
  write_stub "$name" <<EOF
#!/usr/bin/env bash
printf '%s %s cwd=%s GIT_DIR=[%s] GIT_WORK_TREE=[%s]\n' \\
  "$name" "\$*" "\${PWD#\$HOME/}" "\${GIT_DIR:-}" "\${GIT_WORK_TREE:-}" >>"\$RUNNER_LOG"
exit "\${${upper}_EXIT:-0}"
EOF
}

# make_project DIR LOCKFILE [TEST_SCRIPT] - a project the script can discover.
# Omitting TEST_SCRIPT writes a package.json with no scripts at all; passing an
# empty LOCKFILE writes none. node_modules is created unless NO_MODULES is set.
make_project() {
  local dir="$HOME/$1" lock=$2 test_script=${3:-}
  mkdir -p "$dir"
  [ -n "${NO_MODULES:-}" ] || mkdir -p "$dir/node_modules"
  [ -z "$lock" ] || : >"$dir/$lock"
  if [ -n "$test_script" ]; then
    printf '{"name":"p","private":true,"scripts":{"test":"%s"}}\n' "$test_script" >"$dir/package.json"
  else
    printf '{"name":"p","private":true}\n' >"$dir/package.json"
  fi
}

@test "test suites do not inherit the dotfiles GIT_DIR/GIT_WORK_TREE" {
  write_runner_stub bun
  make_project .config/skl bun.lock "bun test"

  run bash "$SCRIPT" .config/skl/src/core/args.ts

  [ "$status" -eq 0 ]
  [[ "$(cat "$RUNNER_LOG")" == *"GIT_DIR=[] GIT_WORK_TREE=[]"* ]]
}

@test "a staged file resolves to its nearest package.json, not an ancestor's" {
  write_runner_stub pnpm
  make_project .pi/agent/extensions pnpm-lock.yaml "node --test web-search/core.test.mjs"
  make_project .pi/agent/extensions/agent-guard pnpm-lock.yaml "node --test guard.test.ts"

  run bash "$SCRIPT" .pi/agent/extensions/agent-guard/guard.ts

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 1 ]
  [[ "$(cat "$RUNNER_LOG")" == *"cwd=.pi/agent/extensions/agent-guard"* ]]
}

@test "a file with no package.json of its own runs the enclosing project" {
  write_runner_stub pnpm
  make_project .pi/agent/extensions pnpm-lock.yaml "node --test web-search/core.test.mjs"

  run bash "$SCRIPT" .pi/agent/extensions/web-search/core.mjs

  [ "$status" -eq 0 ]
  [[ "$(cat "$RUNNER_LOG")" == *"cwd=.pi/agent/extensions"* ]]
}

@test "the lockfile picks the runner" {
  write_runner_stub bun
  write_runner_stub pnpm
  make_project .config/skl bun.lock "bun test"
  make_project .pi/agent/extensions/goal pnpm-lock.yaml "node --test core.test.ts"

  run bash "$SCRIPT" .config/skl/src/core/args.ts .pi/agent/extensions/goal/index.ts

  [ "$status" -eq 0 ]
  [[ "$(cat "$RUNNER_LOG")" == *"bun run test cwd=.config/skl"* ]]
  [[ "$(cat "$RUNNER_LOG")" == *"pnpm run test cwd=.pi/agent/extensions/goal"* ]]
}

@test "a failing suite fails the gate, and one failure doesn't mask another project" {
  write_runner_stub bun
  write_runner_stub pnpm
  export BUN_EXIT=1
  make_project .config/skl bun.lock "bun test"
  make_project .pi/agent/extensions/goal pnpm-lock.yaml "node --test core.test.ts"

  run bash "$SCRIPT" .config/skl/src/core/args.ts .pi/agent/extensions/goal/index.ts

  [ "$status" -eq 1 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 2 ]
}

@test "a project with no scripts.test is skipped silently" {
  write_runner_stub pnpm
  make_project .pi/agent/extensions/agent-state pnpm-lock.yaml

  run bash "$SCRIPT" .pi/agent/extensions/agent-state/index.ts

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
}

@test "an absent runner skips rather than failing" {
  make_project .config/skl bun.lock "bun test"

  run bash "$SCRIPT" .config/skl/src/core/args.ts

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
  [[ "$output" == *"bun absent"* ]]
}

@test "absent node_modules skips rather than failing" {
  write_runner_stub bun
  NO_MODULES=1 make_project .config/skl bun.lock "bun test"

  run bash "$SCRIPT" .config/skl/src/core/args.ts

  [ "$status" -eq 0 ]
  [ ! -s "$RUNNER_LOG" ]
  [[ "$output" == *"node_modules absent"* ]]
}

@test "--all discovers every project with tests across the roots" {
  write_runner_stub bun
  write_runner_stub pnpm
  make_project .config/skl bun.lock "bun test"
  make_project src/pin-audit bun.lock "bun test"
  make_project .pi/agent/extensions pnpm-lock.yaml "node --test web-search/core.test.mjs"
  make_project .pi/agent/extensions/agent-guard pnpm-lock.yaml "node --test guard.test.ts"
  make_project .pi/agent/extensions/agent-state pnpm-lock.yaml

  run bash "$SCRIPT" --all

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 4 ]
  [[ "$(cat "$RUNNER_LOG")" != *agent-state* ]]
}

@test "node_modules is never itself discovered as a project" {
  write_runner_stub bun
  make_project .config/skl bun.lock "bun test"
  mkdir -p "$HOME/.config/skl/node_modules/dep"
  printf '{"name":"dep","scripts":{"test":"exit 1"}}\n' \
    >"$HOME/.config/skl/node_modules/dep/package.json"

  run bash "$SCRIPT" --all

  [ "$status" -eq 0 ]
  [ "$(wc -l <"$RUNNER_LOG" | tr -d ' ')" -eq 1 ]
}
