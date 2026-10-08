#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
load test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../../.claude/statusline.sh"

setup() {
  command -v jq >/dev/null || skip "jq not installed"
  setup_test_home
  mkdir -p "$HOME/.claude/hooks"
  cp "$REAL_HOME/.claude/hooks/profile-label.sh" "$HOME/.claude/hooks/profile-label.sh"
  unset CLAUDE_CONFIG_DIR
  write_stub date <<'SH'
#!/bin/sh
printf '%s\n' 1760000000
SH
}

render() {
  set -o pipefail
  printf '%s' "$1" | "$BASH5" "$SCRIPT" | sed $'s/\033\\[[0-9;]*m//g'
}

@test "shows current-account 5h and weekly usage with reset countdowns" {
  run -0 render '{"rate_limits":{
    "five_hour":{"used_percentage":18,"resets_at":1760008880},
    "seven_day":{"used_percentage":42,"resets_at":1760291600}}}'
  [[ "$output" == *"usage 5h 18% ↻ 2h 28m | weekly 42% ↻ 3d 9h"* ]] || false
}

@test "a weekly-only account has no invented 5h window" {
  run -0 render '{"rate_limits":{"seven_day":{"used_percentage":42,"resets_at":1760291600}}}'
  [[ "$output" == *"usage weekly 42% ↻ 3d 9h"* ]] || false
  [[ "$output" != *"5h"* ]] || false
}

@test "preserves valid zero and fractional usage" {
  run -0 render '{"rate_limits":{
    "five_hour":{"used_percentage":0,"resets_at":1760000060},
    "seven_day":{"used_percentage":42.5,"resets_at":1760291600}}}'
  [[ "$output" == *"usage 5h 0% ↻ 1m | weekly 42.5%"* ]] || false
}

@test "missing and null quota readings are unavailable rather than zero" {
  for payload in '{}' '{"rate_limits":null}' '{"rate_limits":{"five_hour":{"used_percentage":null}}}'; do
    run -0 render "$payload"
    [[ "$output" == *"usage unavailable"* ]] || false
    [[ "$output" != *"0%"* ]] || false
  done
}

@test "an elapsed reset asks for refresh rather than showing an imminent reset" {
  run -0 render '{"rate_limits":{"five_hour":{"used_percentage":100,"resets_at":1759999999}}}'
  [[ "$output" == *"usage 5h 100% ↻ refresh needed"* ]] || false
  [[ "$output" != *"0m"* ]] || false
}

@test "a missing reset time does not invent a countdown" {
  run -0 render '{"rate_limits":{"five_hour":{"used_percentage":18}}}'
  [[ "$output" == *"usage 5h 18% ↻ ?"* ]] || false
}

@test "quota readings stay on one line and coexist with prompt-cache health" {
  run -0 render '{"rate_limits":{"five_hour":{"used_percentage":18,"resets_at":1760008880}},
    "prompt_cache":{"caching_observed":true,"ttl":"1h","expires_at":1760003130,"misses":0}}'
  [[ "$output" == *"usage 5h 18% ↻ 2h 28m | ● 1h 52:10"* ]] || false
  [ "${#lines[@]}" -eq 1 ]
}
