#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

setup() {
  setup_test_home
}

@test "track-bind writes valid JSONL with spaces and quotes" {
  run sh "$TESTS_DIR/../../tmux/scripts/track-bind.sh" \
    'M-s' \
    'skill-loader' \
    'main session' \
    '1' \
    '2' \
    "$HOME/projects/space and \"quote\"" \
    'host name'
  [ "$status" -eq 0 ]

  local log="$HOME/.local/state/tmux/usage.jsonl"
  [ -f "$log" ]
  jq -e \
    '.key == "M-s" and .name == "skill-loader" and .session == "main session" and .path == $path and .host == "host name"' \
    --arg path "$HOME/projects/space and \"quote\"" \
    "$log"
}
