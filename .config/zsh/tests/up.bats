#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

UP="$FUNCTIONS_DIR/nix/up"

setup() {
  # Darwin-gate for determinism: the dispatch we assert is the macOS branch
  # (mise + brew + flake + drs). Linux paths (apt/nrs/hms) differ.
  [[ "$OSTYPE" == darwin* ]] || skip "macOS only (asserts the darwin up branch)"
  setup_test_home

  mkdir -p "$TEST_HOME/.config/mise" "$TEST_HOME/.config/nix"
  : >"$TEST_HOME/.config/mise/mise.lock" # committed lock exists, empty

  for cmd in brew drs macup-check tmux-upstream \
    claude-channels-patch claude-computer-use-patch; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"$TEST_LOG"
exit 0
EOF
  done

  # mise: log; on \`upgrade\`, simulate a tool bump (lockfile change) when
  # MISE_SIMULATE_BUMP is set, so the \`mise lock -g\` refresh gate is exercised.
  write_stub mise <<'EOF'
#!/usr/bin/env bash
echo "mise $*" >>"$TEST_LOG"
if [ "$1" = "upgrade" ] && [ -n "${MISE_SIMULATE_BUMP:-}" ]; then
  echo "bumped" >>"$HOME/.config/mise/mise.lock"
fi
exit 0
EOF

  # nfu: log; write flake.lock so the flake commit branch is exercised.
  write_stub nfu <<'EOF'
#!/usr/bin/env bash
echo "nfu $*" >>"$TEST_LOG"
echo "updated" >>"$HOME/.config/nix/flake.lock"
exit 0
EOF

  # dotfiles: log; `diff --cached --quiet -- PATH` reports changes (exit 1)
  # only when PATH is a non-empty file, mirroring git so the commit branch
  # fires exactly when that lockfile actually changed.
  write_stub dotfiles <<'EOF'
#!/usr/bin/env bash
echo "dotfiles $*" >>"$TEST_LOG"
if [[ "$*" == *"diff --cached --quiet"* ]]; then
  for a in "$@"; do f="$a"; done # last arg = path
  [ -s "$f" ] && exit 1 || exit 0
fi
exit 0
EOF
}

@test "up bumps both lockfiles: mise lock refresh + commit each, brew, flake" {
  MISE_SIMULATE_BUMP=1 run_zsh_function "$UP"
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  grep -qF 'mise lock' "$TEST_LOG"      # refresh ran because the lock changed
  ! grep -qF 'mise install' "$TEST_LOG" # default path bumps, never frozen-installs
  grep -qF 'dotfiles commit -m chore(mise): update tool lock' "$TEST_LOG"
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
  grep -qF 'nfu' "$TEST_LOG"
}

@test "up skips mise lock refresh + mise commit when nothing bumped" {
  run_zsh_function "$UP" # no MISE_SIMULATE_BUMP -> lock unchanged
  [ "$status" -eq 0 ]
  grep -qF 'mise upgrade' "$TEST_LOG"
  ! grep -qF 'mise lock' "$TEST_LOG" # optimisation: no redundant refresh
  ! grep -qF 'update tool lock' "$TEST_LOG"
  # the flake half still runs independently of the mise no-op
  grep -qF 'dotfiles commit -m chore(nix): update flake lock' "$TEST_LOG"
  grep -qF 'brew update' "$TEST_LOG"
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
