#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CHECK="$FUNCTIONS_DIR/claude/claude-commit-note-check"
MARKER_REL=".cache/claude-commit-note-check.stale"

# The two built-in Bash-tool strings the ~/.claude/system-append.md override
# depends on still existing in the claude binary.
NOTE1='Commit or push only when the user asks'
NOTE2='If on the default branch, branch first'

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
}

@test "--check passes when both git-note strings are present" {
  printf 'prefix %s ... %s suffix' "$NOTE1" "$NOTE2" >"$HOME/claude"

  run_zsh_function "$CHECK" --check "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"ok:"* ]]
}

@test "--check fails and names the missing string when one is gone" {
  printf 'prefix %s suffix' "$NOTE1" >"$HOME/claude" # NOTE2 absent

  run_zsh_function "$CHECK" --check "$HOME/claude"

  [ "$status" -eq 1 ]
  [[ "$output" == *"STALE"* ]]
  [[ "$output" == *"$NOTE2"* ]]
}

@test "default mode (no flag) behaves like --check" {
  printf 'prefix %s suffix' "$NOTE1" >"$HOME/claude"

  run_zsh_function "$CHECK" "$HOME/claude"

  [ "$status" -eq 1 ]
}

@test "--reapply writes a marker and exits 0 when a string is gone" {
  printf 'prefix %s suffix' "$NOTE1" >"$HOME/claude"

  run_zsh_function "$CHECK" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  grep -qF "$HOME/claude" "$HOME/$MARKER_REL"
  grep -qF "$NOTE2" "$HOME/$MARKER_REL"
}

@test "--reapply clears a stale marker when both strings are present again" {
  printf 'prefix %s ... %s suffix' "$NOTE1" "$NOTE2" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$CHECK" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"ok:"* ]]
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "reports both strings when both are gone" {
  printf 'prefix nothing here suffix' >"$HOME/claude"

  run_zsh_function "$CHECK" --check "$HOME/claude"

  [ "$status" -eq 1 ]
  [[ "$output" == *"$NOTE1"* ]]
  [[ "$output" == *"$NOTE2"* ]]
}

@test "missing target file is reported and non-zero under --check" {
  run_zsh_function "$CHECK" --check "$HOME/does-not-exist"

  [ "$status" -eq 1 ]
  [[ "$output" == *"skip (missing)"* ]]
}
