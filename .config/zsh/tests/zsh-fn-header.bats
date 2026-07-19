#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CHECK="$(cd "$TESTS_DIR/../../.." && pwd)/.hk-hooks/zsh-fn-header-check.sh"

setup() {
  setup_test_home
  FIXTURES="$BATS_TEST_TMPDIR/functions"
  mkdir -p "$FIXTURES"
}

@test "dual-mode file with correct line-2 header passes" {
  cat >"$FIXTURES/good" <<'EOF'
#!/usr/bin/env zsh
# good: does a thing
echo hi
EOF

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
