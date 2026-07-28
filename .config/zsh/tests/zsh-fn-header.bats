#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CHECK="$(cd "$TESTS_DIR/../../.." && pwd)/.hk-hooks/zsh-fn-header-check.sh"

setup() {
  setup_test_home
  FIXTURES="$BATS_TEST_TMPDIR/functions"
  mkdir -p "$FIXTURES"
}

# A dual-mode fixture is executable unless a test says otherwise: the shebang is
# what makes zfn-link publish a PATH symlink, so mode 755 is part of being
# dual-mode, and every other test should fail for its own reason, not this one.
executable() {
  chmod +x "$@"
}

@test "dual-mode file with correct line-2 header passes" {
  cat >"$FIXTURES/good" <<'EOF'
#!/usr/bin/env zsh
# good: does a thing
echo hi
EOF

  executable "$FIXTURES/good"

  run bash "$CHECK" "$FIXTURES/good"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "zsh-only file with marker and correct line-1 header passes" {
  cat >"$FIXTURES/onlyzsh" <<'EOF'
# onlyzsh: changes directory
# zsh-only: cd (must run in caller's shell)
cd /
EOF

  run bash "$CHECK" "$FIXTURES/onlyzsh"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "header missing the name prefix fails and names the file" {
  cat >"$FIXTURES/nohdr" <<'EOF'
#!/usr/bin/env zsh
# does a thing without naming itself
echo hi
EOF

  executable "$FIXTURES/nohdr"

  run bash "$CHECK" "$FIXTURES/nohdr"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/nohdr"* ]]
  [[ "$output" == *"# nohdr: <purpose>"* ]]
}

@test "shebang-less file without zsh-only marker fails" {
  cat >"$FIXTURES/unmarked" <<'EOF'
# unmarked: has a header but no shebang or marker
echo hi
EOF

  run bash "$CHECK" "$FIXTURES/unmarked"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/unmarked"* ]]
  [[ "$output" == *"zsh-only"* ]]
}

@test "file with both shebang and zsh-only marker fails" {
  cat >"$FIXTURES/both" <<'EOF'
#!/usr/bin/env zsh
# both: dual-mode yet marked zsh-only
# zsh-only: cd (must run in caller's shell)
echo hi
EOF

  executable "$FIXTURES/both"

  run bash "$CHECK" "$FIXTURES/both"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/both"* ]]
  [[ "$output" == *"must not carry"* ]]
}

@test "aside header form '# name (aside):' fails" {
  cat >"$FIXTURES/aside" <<'EOF'
#!/usr/bin/env zsh
# aside (extra words): does a thing
echo hi
EOF

  executable "$FIXTURES/aside"

  run bash "$CHECK" "$FIXTURES/aside"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/aside"* ]]
}

@test "several files with one bad names only the bad one" {
  cat >"$FIXTURES/good" <<'EOF'
#!/usr/bin/env zsh
# good: does a thing
echo hi
EOF
  cat >"$FIXTURES/bad" <<'EOF'
# bad file with no proper header
echo hi
EOF

  executable "$FIXTURES/good"

  executable "$FIXTURES/good"

  run bash "$CHECK" "$FIXTURES/good" "$FIXTURES/bad"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/bad"* ]]
  [[ "$output" != *"$FIXTURES/good"* ]]
}

@test "jq helpers are skipped" {
  cat >"$FIXTURES/helper.jq" <<'EOF'
.foo | .bar
EOF

  run bash "$CHECK" "$FIXTURES/helper.jq"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "dual-mode file that is not executable fails" {
  # zfn-link publishes a ~/.local/bin symlink for any shebang-carrying function,
  # and a mode-644 target makes every call through it "permission denied" while
  # the interactive autoload path keeps working - invisible to the author.
  cat >"$FIXTURES/notexec" <<'EOF'
#!/usr/bin/env zsh
# notexec: dual-mode but left at mode 644
echo hi
EOF

  run bash "$CHECK" "$FIXTURES/notexec"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$FIXTURES/notexec"* ]]
  [[ "$output" == *"executable"* ]]
}

@test "zsh-only file need not be executable" {
  cat >"$FIXTURES/autoloadonly" <<'EOF'
# autoloadonly: sourced into the caller's shell
# zsh-only: export (must reach the caller's environment)
export FOO=1
EOF

  run bash "$CHECK" "$FIXTURES/autoloadonly"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
