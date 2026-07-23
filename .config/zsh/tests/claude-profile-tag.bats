#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/claude-profile-tag.sh"

# Assertions run against a throwaway private tmux server (real infrastructure,
# not a stub) so the option is set/read exactly as in production. Mirrors
# agent-state.bats: unique -L socket per test, bare -f /dev/null server, $TMUX
# exported so bare `tmux` in the script targets this private server.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="claudeprofiletag_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  PANE="$(tx display-message -p -t s '#{pane_id}')"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

tag() { tx show-options -pqv -t "$1" @claude_profile; }

# Build a config dir with a `label` file and echo its path.
labelled_cfg() {
  local dir="$BATS_TEST_TMPDIR/$1"
  mkdir -p "$dir"
  printf '%s' "$2" >"$dir/label"
  printf '%s' "$dir"
}

@test "set writes the profile label onto the pane" {
  cfg="$(labelled_cfg stretch str)"
  run env CLAUDE_PROFILE_PANE="$PANE" CLAUDE_CONFIG_DIR="$cfg" sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(tag "$PANE")" = "str" ]
}

@test "set falls back to the def label for a .claude config dir" {
  cfg="$BATS_TEST_TMPDIR/.claude"
  mkdir -p "$cfg"
  run env CLAUDE_PROFILE_PANE="$PANE" CLAUDE_CONFIG_DIR="$cfg" sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(tag "$PANE")" = "def" ]
}

@test "clear removes the tag" {
  cfg="$(labelled_cfg stretch str)"
  env CLAUDE_PROFILE_PANE="$PANE" CLAUDE_CONFIG_DIR="$cfg" sh "$SCRIPT"
  [ "$(tag "$PANE")" = "str" ]
  run env CLAUDE_PROFILE_PANE="$PANE" sh "$SCRIPT" clear
  [ "$status" -eq 0 ]
  [ -z "$(tag "$PANE")" ]
}

@test "quiet no-op with no resolvable pane" {
  run env -u TMUX -u TMUX_PANE CLAUDE_PROFILE_PANE= sh "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "exits cleanly when the pane cannot be resolved" {
  run env CLAUDE_PROFILE_PANE=%999 sh "$SCRIPT"
  [ "$status" -eq 0 ]
}
