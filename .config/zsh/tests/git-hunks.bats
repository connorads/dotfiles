#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

ROOT_DIR="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
GIT_HUNKS="$ROOT_DIR/.local/bin/git-hunks"

setup() {
  setup_test_home
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$TMPDIR"
}

init_repo() {
  local repo="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  printf 'line %02d\n' {1..20} >"$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -q -m initial
  printf '%s\n' "$repo"
}

make_two_hunks() {
  local repo=$1
  python3 - "$repo/file.txt" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
lines[1] = "line 02 changed"
lines[17] = "line 18 changed"
path.write_text("\n".join(lines) + "\n")
PY
}

@test "list prints stable IDs for unstaged hunks" {
  repo=$(init_repo)
  make_two_hunks "$repo"

  run bash -c "cd '$repo' && '$GIT_HUNKS' list"

  [ "$status" -eq 0 ]
  [[ "$output" == *"file.txt:@-1,"*"+1,"* ]]
  [[ "$output" == *"file.txt:@-15,"*"+15,"* ]]
  [[ "$output" == *"line 02 changed"* ]]
  [[ "$output" == *"line 18 changed"* ]]
  [[ "$output" == *"---"* ]]
}

@test "list --staged reports staged hunks" {
  repo=$(init_repo)
  make_two_hunks "$repo"
  git -C "$repo" add file.txt

  run bash -c "cd '$repo' && '$GIT_HUNKS' list --staged"

  [ "$status" -eq 0 ]
  [[ "$output" == *"file.txt:@-1,"*"+1,"* ]]
  [[ "$output" == *"file.txt:@-15,"*"+15,"* ]]
}

@test "add stages only the selected hunk" {
  repo=$(init_repo)
  make_two_hunks "$repo"
  first_id=$(cd "$repo" && "$GIT_HUNKS" list | awk -F: '/^file\.txt:@/ { print $0; exit }')

  run bash -c "cd '$repo' && '$GIT_HUNKS' add '$first_id'"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Staged: $first_id"* ]]
  cached=$(git -C "$repo" diff --cached)
  unstaged=$(git -C "$repo" diff)
  [[ "$cached" == *"line 02 changed"* ]]
  [[ "$cached" != *"line 18 changed"* ]]
  [[ "$unstaged" == *"line 18 changed"* ]]
}

@test "add rejects invalid hunk ID format" {
  repo=$(init_repo)

  run bash -c "cd '$repo' && '$GIT_HUNKS' add not-a-hunk"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid hunk ID format: not-a-hunk"* ]]
}

@test "add rejects a well-formed absent hunk ID" {
  repo=$(init_repo)
  make_two_hunks "$repo"

  run bash -c "cd '$repo' && '$GIT_HUNKS' add 'file.txt:@-99,1+99,1'"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Hunk not found: file.txt:@-99,1+99,1"* ]]
}

@test "unknown command reports usage hint" {
  repo=$(init_repo)

  run bash -c "cd '$repo' && '$GIT_HUNKS' nope"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown command: nope"* ]]
  [[ "$output" == *"Run 'git hunks -h' for usage."* ]]
}

@test "list rejects unknown options" {
  repo=$(init_repo)

  run bash -c "cd '$repo' && '$GIT_HUNKS' list --bogus"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown option: --bogus"* ]]
}

@test "top-level help prints command summary" {
  run "$GIT_HUNKS" -h

  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: git hunks <command> [options]"* ]]
  [[ "$output" == *"list"* ]]
  [[ "$output" == *"add"* ]]
}
