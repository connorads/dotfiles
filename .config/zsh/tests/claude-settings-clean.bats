#!/usr/bin/env bats
#
# claude-settings-clean: the git clean filter for .claude/settings.json.
#
# Claude Code owns that file and rewrites it whole whenever it persists a
# setting, so the filter's job is to make git's view of it depend only on the
# settings a human chose - not on the machine, and not on the order Claude Code
# happened to emit.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CLEAN="$FUNCTIONS_DIR/claude-settings-clean"

setup() {
  command -v jq >/dev/null || skip "jq not on PATH"
  cd "$BATS_TEST_TMPDIR" || return 1
}

# The filter reads stdin and writes stdout, exactly as git invokes it.
clean() {
  zsh --no-rcs "$CLEAN" <"$1"
}

@test "a reorder of the same settings cleans to the same bytes" {
  printf '%s\n' '{"permissions":{"allow":["Bash(ls:*)"],"ask":["Bash(gh pr merge:*)"]},"env":{"FOO":"1"}}' >a.json
  printf '%s\n' '{"env":{"FOO":"1"},"permissions":{"ask":["Bash(gh pr merge:*)"],"allow":["Bash(ls:*)"]}}' >b.json

  run clean a.json
  [ "$status" -eq 0 ]
  local first=$output

  run clean b.json
  [ "$status" -eq 0 ]
  [ "$output" = "$first" ]
}

@test "drops the machine-local model and auth keys" {
  printf '%s\n' '{"model":"opus","theme":"dark","env":{"ANTHROPIC_API_KEY":"sk-secret","FOO":"1"}}' >in.json

  run clean in.json
  [ "$status" -eq 0 ]
  [[ $output != *model* ]]
  [[ $output != *sk-secret* ]]
  [[ $output == *theme* ]]
  [[ $output == *FOO* ]]
}

@test "keeps permission arrays in their authored order" {
  printf '%s\n' '{"permissions":{"allow":["Bash(zzz:*)","Bash(aaa:*)","Bash(mmm:*)"]}}' >in.json

  run clean in.json
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.permissions.allow | join(",")')" = "Bash(zzz:*),Bash(aaa:*),Bash(mmm:*)" ]
}

@test "emits Claude Code's 2-space indent" {
  printf '%s\n' '{"env":{"FOO":"1"}}' >in.json

  run clean in.json
  [ "$status" -eq 0 ]
  [[ $output == *'
  "env": {
    "FOO": "1"
  }'* ]]
}
