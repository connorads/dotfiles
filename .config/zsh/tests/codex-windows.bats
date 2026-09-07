#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CODEX_WINDOWS="$FUNCTIONS_DIR/codex-windows.jq"

# Black-box the pure classifier: feed raw Codex JSON on stdin, assert the
# normalised, duration-sorted window array. The branchy coverage lives here so
# the three rendering facades need only one representative regression each.
classify() {
  run jq -cf "$CODEX_WINDOWS"
}

@test "weekly-only in primary slot classifies by real duration, not position" {
  # The live-bug shape: 5h window removed, weekly figure sits in primary_window
  # with limit_window_seconds:604800, secondary null. Must read as one 7d window.
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":98,"limit_window_seconds":604800,"reset_after_seconds":530924},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":604800,"used_percent":98,"reset_after_seconds":530924,"reset_at":0}]' ]
}

@test "both windows with limit_window_seconds sort shortest-first" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":40,"limit_window_seconds":18000,"reset_after_seconds":3600},"secondary_window":{"used_percent":7,"limit_window_seconds":604800,"reset_after_seconds":500000}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":18000,"used_percent":40,"reset_after_seconds":3600,"reset_at":0},{"seconds":604800,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
}

@test "no limit_window_seconds falls back to positional durations" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":40,"reset_after_seconds":3600},"secondary_window":{"used_percent":7,"reset_after_seconds":500000}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":18000,"used_percent":40,"reset_after_seconds":3600,"reset_at":0},{"seconds":604800,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
}

@test "output is duration-sorted even when the shorter window is in the secondary slot" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":7,"limit_window_seconds":604800,"reset_after_seconds":500000},"secondary_window":{"used_percent":40,"limit_window_seconds":18000,"reset_after_seconds":3600}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":18000,"used_percent":40,"reset_after_seconds":3600,"reset_at":0},{"seconds":604800,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
}

@test "null used_percent drops the window" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":null,"limit_window_seconds":18000},"secondary_window":{"used_percent":7,"limit_window_seconds":604800,"reset_after_seconds":500000}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":604800,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
}

@test "both windows null yields an empty array" {
  classify <<'EOF'
{"rate_limit":{"primary_window":null,"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "reset_at is projected through as the absolute reset instant" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":50,"limit_window_seconds":18000,"reset_after_seconds":3600,"reset_at":1767229200},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":18000,"used_percent":50,"reset_after_seconds":3600,"reset_at":1767229200}]' ]
}

@test "missing reset_at defaults to zero, never null" {
  # @tsv turns a null into an empty field, which shifts every later column in
  # codex-usage's TSV consumer. A zero is a value; a null is a silent shift.
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":50,"limit_window_seconds":18000,"reset_after_seconds":3600},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [[ "$output" == *'"reset_at":0'* ]]
  [[ "$output" != *"null"* ]]
}

@test "missing reset_after_seconds defaults to zero" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":50,"limit_window_seconds":18000},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":18000,"used_percent":50,"reset_after_seconds":0,"reset_at":0}]' ]
}
