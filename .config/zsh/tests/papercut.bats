#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

PAPERCUT="$FUNCTIONS_DIR/agents/papercut"

setup() {
  setup_test_home
  export PAPERCUTS_STATE_DIR="$BATS_TEST_TMPDIR/papercuts-state"
  export PAPERCUTS_NOW="2026-07-09T12:00:00Z"

  local jq_dir git_dir
  jq_dir="$(dirname "$(command -v jq)")"
  git_dir="$(dirname "$(command -v git)")"
  export PATH="$TEST_BIN:$jq_dir:$git_dir:/usr/bin:/bin:/usr/sbin:/sbin"
  cd "$HOME"
}

papercuts_file() {
  printf '%s\n' "$PAPERCUTS_STATE_DIR/papercuts.jsonl"
}

@test "help documents purpose and commands" {
  run_zsh_function "$PAPERCUT" --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"Log small non-blocking friction"* ]]
  [[ "$output" == *"not accomplishments or tracked bugs"* ]]
  [[ "$output" == *"what you were doing -> what got in the way"* ]]
  [[ "$output" == *"papercut add"* ]]
  [[ "$output" == *"papercut list"* ]]
  [[ "$output" == *"papercut export"* ]]
}

@test "add creates valid JSONL with defaults" {
  run_zsh_function "$PAPERCUT" add "ran zfn-link -> missing shebang command was skipped"

  [ "$status" -eq 0 ]
  [[ "$output" == "Logged papercut:"* ]]
  [ -f "$(papercuts_file)" ]
  [ "$(wc -l <"$(papercuts_file)" | tr -d ' ')" = 1 ]
  jq -e '
    .schema_version == 1
    and .ts == "2026-07-09T12:00:00Z"
    and .cwd == env.HOME
    and .repo == null
    and .harness == null
    and .model == null
    and .severity == "low"
    and .category == "other"
    and .source == "manual"
    and .summary == "ran zfn-link -> missing shebang command was skipped"
    and .context == null
    and .fix == null
    and (has("status") | not)
    and (.id | test("^pc_[0-9]{8}T[0-9]{6}Z_[0-9a-f_]+$"))
  ' "$(papercuts_file)"
}

@test "add preserves quoted fields and custom metadata" {
  run_zsh_function "$PAPERCUT" add \
    -m "gpt-test" \
    --harness "codex" \
    --severity medium \
    --category command \
    --source cli \
    --context 'stdout said "no such file"' \
    --fix "run zfn-link after adding shebang" \
    "added command -> PATH lookup failed with spaces"

  [ "$status" -eq 0 ]
  jq -e '
    .model == "gpt-test"
    and .harness == "codex"
    and .severity == "medium"
    and .category == "command"
    and .source == "cli"
    and .context == "stdout said \"no such file\""
    and .fix == "run zfn-link after adding shebang"
    and .summary == "added command -> PATH lookup failed with spaces"
  ' "$(papercuts_file)"
}

@test "add detects git repository root" {
  mkdir -p "$BATS_TEST_TMPDIR/repo/subdir"
  git -C "$BATS_TEST_TMPDIR/repo" init --quiet
  cd "$BATS_TEST_TMPDIR/repo/subdir"

  run_zsh_function "$PAPERCUT" add "from repo -> capture root"

  [ "$status" -eq 0 ]
  local repo_root
  repo_root="$(cd "$BATS_TEST_TMPDIR/repo" && pwd -P)"
  jq -e --arg repo "$repo_root" '.repo == $repo' "$(papercuts_file)"
}

@test "add rejects empty summary without appending" {
  run_zsh_function "$PAPERCUT" add ""

  [ "$status" -eq 1 ]
  [[ "$output" == *"Summary is required"* ]]
  [ ! -e "$(papercuts_file)" ]
}

@test "add rejects invalid enum values without appending" {
  run_zsh_function "$PAPERCUT" add --severity urgent "setup -> unclear error"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid severity: urgent"* ]]
  [ ! -e "$(papercuts_file)" ]

  run_zsh_function "$PAPERCUT" add --category weird "setup -> unclear error"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid category: weird"* ]]
  [ ! -e "$(papercuts_file)" ]
}

@test "list handles missing log and json mode" {
  run_zsh_function "$PAPERCUT" list

  [ "$status" -eq 0 ]
  [[ "$output" == "No papercuts logged yet." ]]

  run_zsh_function "$PAPERCUT" list --json

  [ "$status" -eq 0 ]
  [[ "$output" == "[]" ]]
}

@test "list prints newest entries with limit and json array" {
  run_zsh_function "$PAPERCUT" add --severity low "first task -> first friction"
  [ "$status" -eq 0 ]
  export PAPERCUTS_NOW="2026-07-09T12:01:00Z"
  run_zsh_function "$PAPERCUT" add --severity high --category error "second task -> second friction"
  [ "$status" -eq 0 ]

  run_zsh_function "$PAPERCUT" list --limit 1

  [ "$status" -eq 0 ]
  [[ "$output" == *"second task -> second friction"* ]]
  [[ "$output" == *"[high/error]"* ]]
  [[ "$output" != *"first task -> first friction"* ]]

  run_zsh_function "$PAPERCUT" list --json

  [ "$status" -eq 0 ]
  printf '%s\n' "$output" | jq -e '
    length == 2
    and .[0].summary == "second task -> second friction"
    and .[1].summary == "first task -> first friction"
  '
}

@test "autoload use does not leak helper functions" {
  run zsh --no-rcs -c '
    fpath=("$1" $fpath)
    autoload -Uz papercut
    PAPERCUTS_STATE_DIR="$2" papercut path >/dev/null
    whence -w papercut_usage papercut_add papercut_list >/dev/null 2>&1
  ' zsh "$FUNCTIONS_DIR/agents" "$PAPERCUTS_STATE_DIR"

  [ "$status" -ne 0 ]
}

@test "autoload repeated adds in the same second get unique ids" {
  run zsh --no-rcs -c '
    fpath=("$1" $fpath)
    autoload -Uz papercut
    export PAPERCUTS_STATE_DIR="$2"
    export PAPERCUTS_NOW="2026-07-09T12:00:00Z"
    papercut add "first -> same shell" >/dev/null
    papercut add "second -> same shell" >/dev/null
    jq -r .id "$PAPERCUTS_STATE_DIR/papercuts.jsonl" | sort -u | wc -l | tr -d " "
  ' zsh "$FUNCTIONS_DIR/agents" "$PAPERCUTS_STATE_DIR"

  [ "$status" -eq 0 ]
  [ "$output" = 2 ]
}

@test "export renders markdown report from JSONL" {
  run_zsh_function "$PAPERCUT" add \
    --severity medium \
    --category docs \
    --context "instruction was buried" \
    --fix "put intent in help text" \
    "looked for command purpose -> help lacked intent"

  [ "$status" -eq 0 ]
  run_zsh_function "$PAPERCUT" export --format markdown

  [ "$status" -eq 0 ]
  [[ "$output" == *"# Papercuts"* ]]
  [[ "$output" == *"## Entries"* ]]
  [[ "$output" == *"looked for command purpose -> help lacked intent"* ]]
  [[ "$output" == *"Severity: medium"* ]]
  [[ "$output" == *"Category: docs"* ]]
  [[ "$output" == *"Context: instruction was buried"* ]]
  [[ "$output" == *"Possible fix: put intent in help text"* ]]
}

@test "export handles missing log and jsonl format" {
  run_zsh_function "$PAPERCUT" export --format markdown

  [ "$status" -eq 0 ]
  [[ "$output" == *"# Papercuts"* ]]
  [[ "$output" == *"No papercuts logged yet."* ]]

  run_zsh_function "$PAPERCUT" add "jsonl export -> should stream source"
  [ "$status" -eq 0 ]
  run_zsh_function "$PAPERCUT" export --format jsonl

  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | jq -R 'fromjson?' | jq -s length)" = 1 ]
  [[ "$output" == *"jsonl export -> should stream source"* ]]
}

@test "path prints active storage file" {
  run_zsh_function "$PAPERCUT" path

  [ "$status" -eq 0 ]
  [[ "$output" == "$(papercuts_file)" ]]
}
