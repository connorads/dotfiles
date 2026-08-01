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

make_js_repo() {
  local repo=$1 lockfile=$2 scripts=$3

  make_repo "$repo"
  : >"$repo/$lockfile"
  cat >"$repo/package.json" <<EOF
{ "name": "fixture", "scripts": $scripts }
EOF
}

# A package-manager stub that logs argv, answers `config get ignore-scripts`
# from $IGNORE_SCRIPTS, and succeeds for everything else (`install`).
write_pm_stub() {
  local name=$1

  write_stub "$name" <<EOF
#!/usr/bin/env bash
printf '$name %s\n' "\$*" >>"\$TEST_LOG"
if [ "\$1 \$2 \$3" = "config get ignore-scripts" ]; then
  echo "\${IGNORE_SCRIPTS:-true}"
fi
exit 0
EOF
}

run_rs_js() {
  local repo=$1

  run bash -lc "cd '$repo' && HOME='$HOME' PATH='$PATH' TEST_LOG='$TEST_LOG' CI='' IGNORE_SCRIPTS='${IGNORE_SCRIPTS:-true}' zsh --no-rcs '$RS'"
}

@test "rs reports npm install scripts the ignore-scripts block skipped" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json '{ "postinstall": "patch-package" }'
  write_pm_stub npm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"scripts: postinstall - not run (npm ignore-scripts)"* ]]
  [[ "$output" == *"  run: npm run postinstall"* ]]
}

@test "rs never runs the skipped scripts, it only names them" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json '{ "postinstall": "patch-package" }'
  write_pm_stub npm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  grep -q 'npm install' "$TEST_LOG"
  ! grep -q 'run postinstall' "$TEST_LOG"
}

@test "rs leaves prepare to the hooks report" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json '{ "prepare": "husky" }'
  write_pm_stub npm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" != *"scripts:"* ]]
}

@test "rs stays silent when the repo opts out of ignore-scripts" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json '{ "postinstall": "patch-package" }'
  write_pm_stub npm
  IGNORE_SCRIPTS=false

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" != *"scripts:"* ]]
}

@test "rs lists only the scripts present, in npm execution order" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json \
    '{ "postinstall": "b", "preinstall": "a", "prepare": "husky" }'
  write_pm_stub npm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"scripts: preinstall, postinstall - not run (npm ignore-scripts)"* ]]
  [[ "$output" == *"  run: npm run preinstall"* ]]
  [[ "$output" == *"  run: npm run postinstall"* ]]
}

@test "rs names pnpm as the manager in a pnpm repo" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" pnpm-lock.yaml '{ "postinstall": "wxt prepare" }'
  write_pm_stub pnpm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"scripts: postinstall - not run (pnpm ignore-scripts)"* ]]
  [[ "$output" == *"  run: pnpm run postinstall"* ]]
}

@test "rs stays silent when the repo has no package.json" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_repo "$repo"
  : >"$repo/package-lock.json"
  write_pm_stub npm

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" != *"scripts:"* ]]
}

@test "rs stays silent when jq is absent" {
  local repo="$BATS_TEST_TMPDIR/repo"
  make_js_repo "$repo" package-lock.json '{ "postinstall": "patch-package" }'
  write_pm_stub npm
  PATH="$(path_without jq)"

  run_rs_js "$repo"

  [ "$status" -eq 0 ]
  [[ "$output" == *"=> npm install"* ]]
  [[ "$output" != *"scripts:"* ]]
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
