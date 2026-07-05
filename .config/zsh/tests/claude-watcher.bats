#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031  # per-test env exports are meant to be subshell-local

# Detection + classification for ~/.config/claude-watcher/watcher.sh, driven
# through its `__detect` / `__classify` stdin entrypoints (no tmux needed).
# Asserts observable behaviour only: stdin banner -> stdout label + exit status.
# Real ANSI banners come from the watcher's own tests/fixtures (reused, not
# duplicated); plain-text cases pin the awk window + limit/reset vocabulary and
# the classify ceiling/fallback boundaries.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

WATCHER="$BATS_TEST_DIRNAME/../../claude-watcher/watcher.sh"
FIX="$BATS_TEST_DIRNAME/../../claude-watcher/tests/fixtures"

setup() {
  # Resolve python3 before setup_test_home narrows PATH; the classify path
  # shells out to reset-time.py and finds it via CLAUDE_WATCH_PY.
  local py
  py="$(command -v python3)"
  setup_test_home
  export CLAUDE_WATCH_PY="$py"
  # Fixed "now": 2026-05-31 13:00 America/Santiago. The fixtures' "3pm" reset
  # is then 2h away (< ceiling -> five-hour); "Oct 6" is months away
  # (-> over-ceiling). Matches the legacy tests/test-detect.sh anchor.
  NOW="$("$py" -c 'from datetime import datetime; from zoneinfo import ZoneInfo; print(int(datetime(2026,5,31,13,0,tzinfo=ZoneInfo("America/Santiago")).timestamp()))')"
}

detect() { printf '%s\n' "$1" | sh "$WATCHER" __detect; }
detect_file() { sh "$WATCHER" __detect <"$FIX/$1"; }
classify() { printf '%s\n' "$2" | sh "$WATCHER" __classify --now "$1"; }
classify_file() { sh "$WATCHER" __classify --now "$NOW" <"$FIX/$1"; }

# ---- fixtures: real ANSI banners (also exercises the ANSI strip) ----

@test "detect: 5h banner fixture is rate-limited" {
  run detect_file 5h-banner.txt
  [ "$status" -eq 0 ]
  [ "$output" = detected ]
}

@test "detect: weekly/Opus fixture is rate-limited" {
  run detect_file weekly-opus.txt
  [ "$status" -eq 0 ]
}

@test "detect: wrapped banner (limit/reset split across box lines) is rate-limited" {
  run detect_file wrapped-banner.txt
  [ "$status" -eq 0 ]
}

@test "detect: ordinary output with limit-ish words but no reset is not rate-limited" {
  run detect_file normal-output.txt
  [ "$status" -eq 1 ]
  [ "$output" = none ]
}

@test "detect: mid-stream edit mentioning 'limit' is not rate-limited" {
  run detect_file mid-stream.txt
  [ "$status" -eq 1 ]
}

@test "classify: 5h banner routes to five-hour" {
  run classify_file 5h-banner.txt
  [ "$status" -eq 0 ]
  [ "$output" = five-hour ]
}

@test "classify: wrapped banner routes to five-hour" {
  run classify_file wrapped-banner.txt
  [ "$output" = five-hour ]
}

@test "classify: weekly/Opus banner (days away) routes to over-ceiling" {
  run classify_file weekly-opus.txt
  [ "$status" -eq 0 ]
  [ "$output" = over-ceiling ]
}

@test "classify: non-banner output is none and exits 1" {
  run classify_file normal-output.txt
  [ "$status" -eq 1 ]
  [ "$output" = none ]
}

@test "classify: mid-stream output is none and exits 1" {
  run classify_file mid-stream.txt
  [ "$status" -eq 1 ]
}

# ---- awk window: limit + reset must fall within 6 lines of each other ----

@test "detect: limit and reset exactly 6 lines apart -> detected" {
  run detect "usage limit reached
l2
l3
l4
l5
l6
resets at 3pm"
  [ "$status" -eq 0 ]
}

@test "detect: limit and reset 7 lines apart -> not detected" {
  run detect "usage limit reached
l2
l3
l4
l5
l6
l7
resets at 3pm"
  [ "$status" -eq 1 ]
}

@test "detect: reset line before the limit line but within the window -> detected" {
  run detect "resets at 3pm
l2
l3
l4
l5
l6
usage limit reached"
  [ "$status" -eq 0 ]
}

# ---- limit / reset vocabulary ----

@test "detect: 'N-hour limit' + 'resets at' form" {
  run detect "5-hour limit reached
resets at 4pm"
  [ "$status" -eq 0 ]
}

@test "detect: 'rate limit' + calendar 'resets on' form" {
  run detect "rate limit hit
resets on oct 6"
  [ "$status" -eq 0 ]
}

@test "detect: 'weekly limit' + 'resets in:' form" {
  run detect "weekly limit reached
resets in: 30 minutes"
  [ "$status" -eq 0 ]
}

@test "detect: a lone 'try again in N' line is self-sufficient (limit and reset)" {
  run detect "try again in 5 minutes"
  [ "$status" -eq 0 ]
}

@test "detect: uppercase banner still detected (lowercased before awk)" {
  run detect "CLAUDE USAGE LIMIT REACHED
YOUR LIMIT WILL RESET AT 3PM (AMERICA/SANTIAGO)"
  [ "$status" -eq 0 ]
}

# ---- negatives: one half of the pair alone must not trip ----

@test "detect: a limit word without any reset line -> not detected" {
  run detect "the rate limiter caps requests at 100/min
implementing the retry handler now"
  [ "$status" -eq 1 ]
}

@test "detect: a reset line without any limit line -> not detected" {
  run detect "the migration resets at 3pm tomorrow
carrying on with the task"
  [ "$status" -eq 1 ]
}

# ---- classify: ceiling boundary (strict >) and fallback routing ----

@test "classify: reset just under the ceiling -> five-hour" {
  export CLAUDE_WATCH_MARGIN=0 CLAUDE_WATCH_CEILING=10800
  run classify 1000000000 "usage limit reached, try again in 2 hours"
  [ "$status" -eq 0 ]
  [ "$output" = five-hour ]
}

@test "classify: reset exactly at the ceiling -> five-hour (boundary is strict >)" {
  export CLAUDE_WATCH_MARGIN=0 CLAUDE_WATCH_CEILING=10800
  run classify 1000000000 "usage limit reached, try again in 3 hours"
  [ "$output" = five-hour ]
}

@test "classify: reset just over the ceiling -> over-ceiling" {
  export CLAUDE_WATCH_MARGIN=0 CLAUDE_WATCH_CEILING=10800
  run classify 1000000000 "usage limit reached, try again in 4 hours"
  [ "$status" -eq 0 ]
  [ "$output" = over-ceiling ]
}

@test "classify: detected banner with an unparseable reset uses the fixed fallback" {
  export CLAUDE_WATCH_FALLBACK=18600 CLAUDE_WATCH_CEILING=21600
  run classify 1000000000 "claude usage limit reached, resets at 3pm (Bogus/Zone)"
  [ "$status" -eq 0 ]
  [ "$output" = five-hour ]
}

@test "classify: a fallback larger than the ceiling routes to over-ceiling" {
  export CLAUDE_WATCH_FALLBACK=30000 CLAUDE_WATCH_CEILING=21600
  run classify 1000000000 "claude usage limit reached, resets at 3pm (Bogus/Zone)"
  [ "$output" = over-ceiling ]
}
