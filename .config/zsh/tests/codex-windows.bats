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

@test "no limit_window_seconds reports the duration as unknown, never the slot's default" {
  # Guessing from the slot reproduces, one layer down, the very bug this file
  # exists to prevent: a weekly figure in primary_window would come back 5h.
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":40,"reset_after_seconds":3600},"secondary_window":{"used_percent":7,"reset_after_seconds":500000}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":0,"used_percent":40,"reset_after_seconds":3600,"reset_at":0},{"seconds":0,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
}

@test "duration absent in the primary slot is unknown, not 5h" {
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":14,"reset_after_seconds":559789},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":0,"used_percent":14,"reset_after_seconds":559789,"reset_at":0}]' ]
}

@test "duration absent in the secondary slot is unknown, not 7d" {
  classify <<'EOF'
{"rate_limit":{"primary_window":null,"secondary_window":{"used_percent":37,"reset_after_seconds":3600}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":0,"used_percent":37,"reset_after_seconds":3600,"reset_at":0}]' ]
}

@test "unknown is encoded as zero seconds, never null" {
  # Same @tsv contract as the reset_* fields: a null becomes an empty field and
  # shifts every later column in codex-usage's TSV consumer. 0 is not a valid
  # window length, so it is unambiguous and survives the read intact.
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":14,"reset_after_seconds":559789},"secondary_window":null}}
EOF
  [ "$status" -eq 0 ]
  [[ "$output" != *"null"* ]]
}

@test "a known duration still sorts ahead of an unknown one it is longer than" {
  # Unknown sorts first; the point is only that both windows survive and neither
  # is silently assigned the other's length.
  classify <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":40,"reset_after_seconds":3600},"secondary_window":{"used_percent":7,"limit_window_seconds":604800,"reset_after_seconds":500000}}}
EOF
  [ "$status" -eq 0 ]
  [ "$output" = '[{"seconds":0,"used_percent":40,"reset_after_seconds":3600,"reset_at":0},{"seconds":604800,"used_percent":7,"reset_after_seconds":500000,"reset_at":0}]' ]
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
