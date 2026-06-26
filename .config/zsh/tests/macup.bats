#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MACUP="$FUNCTIONS_DIR/macos/macup"
MACUP_CHECK="$FUNCTIONS_DIR/macos/macup-check"

setup() {
  [[ "$OSTYPE" == darwin* ]] || skip "macOS only (softwareupdate)"
  setup_test_home

  # softwareupdate: log every call; emit the canned scan for -l, succeed otherwise.
  write_stub softwareupdate <<'EOF'
#!/usr/bin/env bash
echo "softwareupdate $*" >>"$TEST_LOG"
for a in "$@"; do
  if [ "$a" = "-l" ] || [ "$a" = "--list" ]; then
    cat "$SU_FIXTURE" 2>/dev/null
    exit 0
  fi
done
exit 0
EOF

  # sudo: log, then exec the wrapped command (hits the softwareupdate stub).
  write_stub sudo <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >>"$TEST_LOG"
exec "$@"
EOF
}

write_su_fixture() {
  SU_FIXTURE="$BATS_TEST_TMPDIR/su.txt"
  export SU_FIXTURE
  printf '%b' "$1" >"$SU_FIXTURE"
}

CLT_BLOCK='* Label: Command Line Tools for Xcode 26.6-26.6\n\tTitle: Command Line Tools for Xcode 26.6, Version: 26.6, Size: 920431KiB, Recommended: YES, \n'
OS_BLOCK='* Label: macOS Tahoe 26.6-25G80\n\tTitle: macOS Tahoe 26.6, Version: 26.6, Size: 7654321KiB, Recommended: YES, Action: restart, \n'
HEADER='Software Update Tool\n\nFinding available software\nSoftware Update found the following new or updated software:\n'
NONE='Software Update Tool\n\nFinding available software\nNo new software available.\n'

# --- macup-check (read-only) ---

@test "macup-check is silent and exits 0 when up to date" {
  write_su_fixture "$NONE"
  run_zsh_function "$MACUP_CHECK"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "macup-check reports a no-restart update without the restart note" {
  write_su_fixture "$HEADER$CLT_BLOCK"
  run_zsh_function "$MACUP_CHECK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"updates available"* ]]
  [[ "$output" == *"Command Line Tools for Xcode 26.6"* ]]
  [[ "$output" != *"RESTART"* ]]
}

@test "macup-check flags a restart-required update" {
  write_su_fixture "$HEADER$OS_BLOCK"
  run_zsh_function "$MACUP_CHECK"
  [ "$status" -eq 0 ]
  [[ "$output" == *"RESTART"* ]]
}

@test "macup-check reads the cached scan by default and forces a scan with --scan" {
  write_su_fixture "$NONE"
  run_zsh_function "$MACUP_CHECK"
  grep -qF 'softwareupdate -l --no-scan' "$TEST_LOG"

  : >"$TEST_LOG"
  run_zsh_function "$MACUP_CHECK" --scan
  grep -qF 'softwareupdate -l' "$TEST_LOG"
  ! grep -qF -- '--no-scan' "$TEST_LOG"
}

# --- macup --safe (the path `up --os` uses) ---

@test "macup --safe is a no-op when up to date" {
  write_su_fixture "$NONE"
  run_zsh_function "$MACUP" --safe
  [ "$status" -eq 0 ]
  [[ "$output" == *"already up to date"* ]]
  ! grep -qE 'softwareupdate -i' "$TEST_LOG"
}

@test "macup --safe installs only the no-restart label and reports the OS update, never rebooting" {
  write_su_fixture "$HEADER$CLT_BLOCK$OS_BLOCK"
  run_zsh_function "$MACUP" --safe
  [ "$status" -eq 0 ]

  # installs the safe label by name
  grep -qF 'sudo softwareupdate -i --no-scan Command Line Tools for Xcode 26.6-26.6' "$TEST_LOG"
  # reports — but does not install — the restart-required update
  [[ "$output" == *"Restart-required updates NOT installed"* ]]
  [[ "$output" == *"macOS Tahoe 26.6-25G80"* ]]
  # never reboots: no auto-restart, no owner-auth install
  ! grep -qE -- '-R' "$TEST_LOG"
  ! grep -qF -- '--stdinpass' "$TEST_LOG"
  ! grep -qF 'macOS Tahoe' "$TEST_LOG"
}

@test "macup --safe with only a restart update installs nothing and reports it" {
  write_su_fixture "$HEADER$OS_BLOCK"
  run_zsh_function "$MACUP" --safe
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to install without a restart"* ]]
  [[ "$output" == *"Restart-required updates NOT installed"* ]]
  ! grep -qE 'softwareupdate -i' "$TEST_LOG"
}

# --- arg handling ---

@test "macup --help prints usage and exits 0" {
  run_zsh_function "$MACUP" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: macup"* ]]
}

@test "macup rejects an unknown arg with exit 2" {
  run_zsh_function "$MACUP" --bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown arg"* ]]
}
