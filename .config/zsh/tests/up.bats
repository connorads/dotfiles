#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

UP="$FUNCTIONS_DIR/nix/up"

setup() {
  # Darwin-gate for determinism: the dispatch we assert is the macOS branch
  # (mise + brew + flake + drs). Linux paths (apt/nrs/hms) differ.
  [[ "$OSTYPE" == darwin* ]] || skip "macOS only (asserts the darwin up branch)"
  setup_test_home

  # A committed lockfile must exist for the default path to add/commit it.
  mkdir -p "$TEST_HOME/.config/mise"
  : >"$TEST_HOME/.config/mise/mise.lock"

  # Every external command logs "<name> $*"; succeeds. dotfiles' diff reports
  # changes present (exit 1) so the commit branch is exercised.
  for cmd in mise brew drs nfu macup-check tmux-upstream \
    claude-channels-patch claude-computer-use-patch; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"$TEST_LOG"
exit 0
EOF
  done

  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
echo "dotfiles $*" >>"$TEST_LOG"
case "$*" in
  *"diff --cached --quiet"*) exit 1 ;;  # changes staged -> commit runs
esac
exit 0
EOF
}

@test "up bumps both lockfiles, runs brew + flake, and commits each" {
  run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  grep -qF 'mise lock' "$TEST_LOG"
  ! grep -qF 'mise install' "$TEST_LOG" # default path bumps, never frozen-installs
  grep -qF 'dotfiles commit -m chore(mise): update tool lock' "$TEST_LOG"
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'nfu' "$TEST_LOG"
}

@test "up --frozen converges via mise install with no bumps, brew, flake, or commit" {
  run_zsh_function "$UP" --frozen
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'mise lock' "$TEST_LOG"
  ! grep -qF 'brew' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
  ! grep -qF 'dotfiles commit' "$TEST_LOG"
  # rebuild still proceeds
  grep -qF 'drs' "$TEST_LOG"
}

@test "up -s is an alias for --frozen" {
  run_zsh_function "$UP" -s
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
}

@test "up --skip-flake is an alias for --frozen" {
  run_zsh_function "$UP" --skip-flake
  [ "$status" -eq 0 ]
  grep -qF 'mise install' "$TEST_LOG"
  ! grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'nfu' "$TEST_LOG"
}
