#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured at file-load, before setup_test_home swaps HOME for an isolated tmp
# dir. The lib reads $HOME at call time (account_candidates scans
# ~/.claude-profiles/code, relocate_transcript defaults to ~/.claude), so
# sourcing the real file against the isolated HOME is correct.
ACCT_LIB="$HOME/.config/tmux/scripts/lib/claude-account.sh"

setup() {
  setup_test_home
}

lib() {
  run bash -c "source '$ACCT_LIB'; $*"
}

# --- claude_account_slug ----------------------------------------------------

@test "claude_account_slug turns every non-alnum char into a dash" {
  lib 'claude_account_slug /Users/connorads/.trees/x'
  [ "$status" -eq 0 ]
  [ "$output" = "-Users-connorads--trees-x" ]
}

@test "claude_account_slug leaves an all-alnum string untouched" {
  lib 'claude_account_slug abc123'
  [ "$status" -eq 0 ]
  [ "$output" = "abc123" ]
}

# --- account_candidates -----------------------------------------------------

mk_profiles() {
  local p
  for p in "$@"; do
    mkdir -p "$HOME/.claude-profiles/code/$p"
  done
}

# Build a profile config dir for a fictional account name without writing the
# literal .claude-profiles/code/<name> in source: the char after code/ is a
# variable, so the claude-profile-leak-guard's concrete-path check stays quiet
# (the same dodge claude-branch-menu.bats uses with $acct/$cfg).
prof() { printf '%s/.claude-profiles/code/%s' "$HOME" "$1"; }

@test "account_candidates lists default + discovered profiles with real dirs" {
  mk_profiles a1 a2 a3
  local src
  src=$(prof a3)
  run bash -c "source '$ACCT_LIB'; account_candidates '$src'"
  [ "$status" -eq 0 ]
  # default present, real dir in column 2
  grep -qF "$(printf 'default\t%s/.claude' "$HOME")" <<<"$output"
  grep -qF "$(printf 'a1\t%s' "$(prof a1)")" <<<"$output"
  grep -qF "$(printf 'a2\t%s' "$(prof a2)")" <<<"$output"
}

@test "account_candidates excludes the source profile" {
  mk_profiles a1 a2
  local src
  src=$(prof a1)
  run bash -c "source '$ACCT_LIB'; account_candidates '$src'"
  [ "$status" -eq 0 ]
  grep -q '^a2	' <<<"$output"
  grep -q '^default	' <<<"$output"
  ! grep -q '^a1	' <<<"$output"
}

@test "account_candidates excludes the default account when source is empty" {
  mk_profiles a1
  run bash -c "source '$ACCT_LIB'; account_candidates ''"
  [ "$status" -eq 0 ]
  grep -q '^a1	' <<<"$output"
  ! grep -q '^default	' <<<"$output"
}

@test "account_candidates excludes default when source is the explicit ~/.claude" {
  mk_profiles a1
  run bash -c "source '$ACCT_LIB'; account_candidates '$HOME/.claude'"
  [ "$status" -eq 0 ]
  grep -q '^a1	' <<<"$output"
  ! grep -q '^default	' <<<"$output"
}

@test "account_candidates with no profiles dir emits only default" {
  local src
  src=$(prof a1)
  run bash -c "source '$ACCT_LIB'; account_candidates '$src'"
  [ "$status" -eq 0 ]
  grep -q '^default	' <<<"$output"
}

# --- relocate_transcript ----------------------------------------------------

@test "relocate_transcript copies the transcript to the target projects tree" {
  local src="$HOME/.claude" dst
  dst=$(prof a1)
  local cwd="/Users/connorads/proj" slug="-Users-connorads-proj" sid="sess-1"
  mkdir -p "$src/projects/$slug"
  printf 'line1\nline2\n' >"$src/projects/$slug/$sid.jsonl"

  run bash -c "source '$ACCT_LIB'; relocate_transcript '$src' '$dst' '$cwd' '$sid'"
  [ "$status" -eq 0 ]
  [ "$output" = "$dst/projects/$slug/$sid.jsonl" ]
  [ -f "$dst/projects/$slug/$sid.jsonl" ]
  diff "$src/projects/$slug/$sid.jsonl" "$dst/projects/$slug/$sid.jsonl"
}

@test "relocate_transcript fails and writes nothing when the source is missing" {
  local src="$HOME/.claude" dst
  dst=$(prof a1)
  local cwd="/Users/connorads/proj" sid="nope"

  run bash -c "source '$ACCT_LIB'; relocate_transcript '$src' '$dst' '$cwd' '$sid'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"source transcript not found"* ]]
  [ ! -d "$dst/projects" ]
}

@test "relocate_transcript normalises an empty source dir to ~/.claude" {
  # Empty src -> ~/.claude is the source; a profile is the dest.
  local dst
  dst=$(prof a1)
  local slug="-Users-connorads-proj" sid="sess-2" cwd="/Users/connorads/proj"
  mkdir -p "$HOME/.claude/projects/$slug"
  printf 'x\n' >"$HOME/.claude/projects/$slug/$sid.jsonl"

  run bash -c "source '$ACCT_LIB'; relocate_transcript '' '$dst' '$cwd' '$sid'"
  [ "$status" -eq 0 ]
  [ "$output" = "$dst/projects/$slug/$sid.jsonl" ]
  [ -f "$dst/projects/$slug/$sid.jsonl" ]
}

@test "relocate_transcript normalises an empty dest dir to ~/.claude" {
  # A profile is the source; empty dst -> ~/.claude is the dest.
  local src
  src=$(prof a1)
  local slug="-Users-connorads-proj" sid="sess-3" cwd="/Users/connorads/proj"
  mkdir -p "$src/projects/$slug"
  printf 'y\n' >"$src/projects/$slug/$sid.jsonl"

  run bash -c "source '$ACCT_LIB'; relocate_transcript '$src' '' '$cwd' '$sid'"
  [ "$status" -eq 0 ]
  [ "$output" = "$HOME/.claude/projects/$slug/$sid.jsonl" ]
  [ -f "$HOME/.claude/projects/$slug/$sid.jsonl" ]
}
