#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CODEX_USAGE="$FUNCTIONS_DIR/codex-usage"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.codex"
}

# Seed the meta file: next_retry_at fail_count last_success_at
seed_meta() {
  jq -n --argjson n "$1" --argjson f "$2" --argjson s "$3" \
    '{next_retry_at:$n, fail_count:$f, last_http_status:"", last_error:"", last_success_at:$s}' \
    >"$HOME/.cache/codex-usage.meta.json"
}

@test "renders 5h/7d windows on a fresh cache hit" {
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":42,"limit_window_seconds":18000,"reset_after_seconds":7200},
 "secondary_window":{"used_percent":7,"limit_window_seconds":604800,"reset_after_seconds":86400}}}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"5-hour:"* ]]
  [[ "$output" == *"42%"* ]]
  [[ "$output" == *"7-day:"* ]]
  [[ "$output" == *"resets in"* ]]
}

@test "weekly-only window is labelled 7-day with no phantom 5-hour line" {
  # The live 2026-07 shape: 5h window removed, weekly figure sits in
  # primary_window carrying limit_window_seconds:604800, secondary null.
  # Duration classification must label it 7-day and print no 5-hour line.
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":98,"limit_window_seconds":604800,"reset_after_seconds":530924},"secondary_window":null}}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"7-day:"* ]]
  [[ "$output" == *"98%"* ]]
  [[ "$output" != *"5-hour"* ]]
}

@test "a window the payload gives no duration for is labelled unknown" {
  # The classifier reports seconds:0 rather than guessing the slot's usual
  # length, so the label must say unknown instead of naming a duration.
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":14,"reset_after_seconds":559789},"secondary_window":null}}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"unknown:"* ]]
  [[ "$output" == *"14%"* ]]
  [[ "$output" != *"5-hour"* ]]
  [[ "$output" != *"7-day"* ]]
}

@test "reports paused refresh when there is no cache and retry is in the future" {
  seed_meta 9999999999 0 0

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]
}

@test "not logged in when auth file is missing" {
  seed_meta 0 0 0

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Not logged in"* ]]
}

@test "refreshes the token then fetches usage" {
  cat >"$HOME/.codex/auth.json" <<'EOF'
{"tokens":{"access_token":"old","refresh_token":"r1"}}
EOF
  seed_meta 0 0 0
  write_curl_stub
  printf '{"error":{"message":"unauthorized"}}' >"$BATS_TEST_TMPDIR/401.json"
  printf '{"access_token":"new","refresh_token":"r2","id_token":"id2"}' >"$BATS_TEST_TMPDIR/refresh.json"
  cat >"$BATS_TEST_TMPDIR/usage200.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":55,"limit_window_seconds":18000,"reset_after_seconds":3600},"secondary_window":{"used_percent":11,"limit_window_seconds":604800,"reset_after_seconds":7200}}}
EOF
  export CURL_1_KIND=hb CURL_1_CODE=401 CURL_1_BODY="$BATS_TEST_TMPDIR/401.json"
  export CURL_2_KIND=stdout CURL_2_OUT="$BATS_TEST_TMPDIR/refresh.json"
  export CURL_3_KIND=hb CURL_3_CODE=200 CURL_3_BODY="$BATS_TEST_TMPDIR/usage200.json"

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"5-hour:"* ]]
  [[ "$output" == *"55%"* ]]

  run jq -r '.tokens.access_token' "$HOME/.codex/auth.json"
  [ "$output" = "new" ]
}

@test "records backoff in meta on an HTTP failure without a refresh token" {
  cat >"$HOME/.codex/auth.json" <<'EOF'
{"tokens":{"access_token":"old"}}
EOF
  seed_meta 0 0 1700000000
  write_curl_stub
  printf '{"error":{"message":"server boom"}}' >"$BATS_TEST_TMPDIR/500.json"
  export CURL_1_KIND=hb CURL_1_CODE=500 CURL_1_BODY="$BATS_TEST_TMPDIR/500.json"

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]

  run jq -r '.fail_count' "$HOME/.cache/codex-usage.meta.json"
  [ "$output" = "1" ]
  run jq -r '.last_error' "$HOME/.cache/codex-usage.meta.json"
  [ "$output" = "server boom" ]
  run jq -r '.last_http_status' "$HOME/.cache/codex-usage.meta.json"
  [ "$output" = "500" ]
  run jq -r '.last_success_at' "$HOME/.cache/codex-usage.meta.json"
  [ "$output" = "1700000000" ]
}

seed_reset_fetch() {
  printf '{"tokens":{"access_token":"test-token"}}' >"$HOME/.codex/auth.json"
  seed_meta 0 0 0
  write_curl_stub
  printf '{"rate_limit":{},"rate_limit_reset_credits":{"available_count":2,"applicable_available_count":0}}' >"$BATS_TEST_TMPDIR/usage.json"
  export CURL_1_KIND=hb CURL_1_CODE=200 CURL_1_BODY="$BATS_TEST_TMPDIR/usage.json"
}

@test "fetches reset details into the usage cache when resets are held" {
  seed_reset_fetch
  printf '{"credits":[{"status":"available","expires_at":"2026-10-04T02:11:09Z"}]}' >"$BATS_TEST_TMPDIR/details.json"
  export CURL_2_KIND=stdout CURL_2_OUT="$BATS_TEST_TMPDIR/details.json"

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  run jq -r '._reset_credit_details.credits[0].expires_at' "$HOME/.cache/codex-usage.json"
  [ "$output" = "2026-10-04T02:11:09Z" ]

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [ "$(cat "$CURL_STATE")" = 2 ]
}

@test "no reset credits skips the details request" {
  seed_reset_fetch
  printf '{"rate_limit":{},"rate_limit_reset_credits":{"available_count":0}}' >"$BATS_TEST_TMPDIR/usage.json"

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  [ "$(cat "$CURL_STATE")" = 1 ]
}

@test "failed reset details do not fail usage or retain previous expiry data" {
  seed_reset_fetch
  printf '{"_reset_credit_details":{"credits":[{"expires_at":"2026-10-04T02:11:09Z"}]}}' >"$HOME/.cache/codex-usage.json"
  touch -t 202001010000 "$HOME/.cache/codex-usage.json"
  export CURL_2_KIND=net

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  run jq -r '[.rate_limit_reset_credits.available_count, has("_reset_credit_details")] | @json' "$HOME/.cache/codex-usage.json"
  [ "$output" = '[2,false]' ]
}

@test "malformed reset details are not cached" {
  seed_reset_fetch
  printf '{"credits":"invalid"}' >"$BATS_TEST_TMPDIR/details.json"
  export CURL_2_KIND=stdout CURL_2_OUT="$BATS_TEST_TMPDIR/details.json"

  run_zsh_function "$CODEX_USAGE"

  [ "$status" -eq 0 ]
  run jq 'has("_reset_credit_details")' "$HOME/.cache/codex-usage.json"
  [ "$output" = false ]
}
