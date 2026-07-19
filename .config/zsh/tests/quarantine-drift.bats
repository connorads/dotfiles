#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

# agent-glyphs precedent: no setup_test_home. The checker's job is asserting
# the REAL tracked configs agree, so the positive case runs against real $HOME.
CHECKER="$HOME/.hk-hooks/quarantine-drift.py"

@test "all tracked quarantine spellings agree today" {
  run python3 "$CHECKER"
  [ "$status" -eq 0 ]
}

@test "a drifted value fails the check and names the file" {
  cd "$BATS_TEST_TMPDIR"
  # cwd-resolved .npmrc shadows the real one; the other eight still come from $HOME
  echo "min-release-age=7" >.npmrc
  run python3 "$CHECKER"
  [ "$status" -eq 1 ]
  [[ "$output" == *".npmrc"* ]]
  [[ "$output" == *"min-release-age = 7"* ]]
}

@test "a config missing its key fails the check" {
  cd "$BATS_TEST_TMPDIR"
  echo "# gate removed" >.npmrc
  run python3 "$CHECKER"
  [ "$status" -eq 1 ]
  [[ "$output" == *"min-release-age not found"* ]]
}
