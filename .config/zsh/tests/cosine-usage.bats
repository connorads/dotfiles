#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

COSINE_USAGE="$FUNCTIONS_DIR/cosine-usage"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.cosine"
}

# Seed the meta file: next_retry_at fail_count last_success_at
seed_meta() {
  jq -n --argjson n "$1" --argjson f "$2" --argjson s "$3" \
    '{next_retry_at:$n, fail_count:$f, last_http_status:"", last_error:"", last_success_at:$s}' \
    >"$HOME/.cache/cosine-usage.meta.json"
}

write_cosine_auth() {
  cat >"$HOME/.cosine/auth.json" <<'EOF'
{"team_id":"team_123","token":"redacted","refresh_token":"redacted"}
EOF
}

@test "renders monthly credits on a fresh cache hit" {
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":250,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-01T00:00:00Z"}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Monthly:"* ]]
  [[ "$output" == *"25%"* ]]
  [[ "$output" == *"resets in"* ]]
  [[ "$output" == *"Credits:"* ]]
  [[ "$output" == *"250/1k"* ]]
}

@test "prints login guidance when auth file is missing" {
  rm -f "$HOME/.cosine/auth.json"
  seed_meta 0 0 0

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Not logged in"* ]]
  [[ "$output" == *"cos login"* ]]
}

@test "reports paused refresh when there is no cache and retry is in the future" {
  seed_meta 9999999999 0 0

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]
}

@test "fetches usage with cosine-bearer and caches a valid response" {
  write_cosine_auth
  seed_meta 0 0 0
  write_stub cosine-bearer <<'EOF'
#!/usr/bin/env bash
printf 'bearer-token'
EOF
  write_curl_stub
  cat >"$BATS_TEST_TMPDIR/usage200.json" <<'EOF'
{"usedTokens":400,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-01T00:00:00Z"}
EOF
  export CURL_1_KIND=hb CURL_1_CODE=200 CURL_1_BODY="$BATS_TEST_TMPDIR/usage200.json"

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Monthly:"* ]]
  [[ "$output" == *"40%"* ]]
  [ -f "$HOME/.cache/cosine-usage.json" ]
  [ "$(cat "$CURL_STATE")" = "1" ]
  [[ "$output" != *"bearer-token"* ]]
}

@test "records backoff in meta on an HTTP failure" {
  write_cosine_auth
  seed_meta 0 0 1700000000
  write_stub cosine-bearer <<'EOF'
#!/usr/bin/env bash
printf 'bearer-token'
EOF
  write_curl_stub
  printf '{"error":{"message":"server boom"}}' >"$BATS_TEST_TMPDIR/500.json"
  export CURL_1_KIND=hb CURL_1_CODE=500 CURL_1_BODY="$BATS_TEST_TMPDIR/500.json"

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]

  run jq -r '.fail_count' "$HOME/.cache/cosine-usage.meta.json"
  [ "$output" = "1" ]
  run jq -r '.last_error' "$HOME/.cache/cosine-usage.meta.json"
  [ "$output" = "server boom" ]
  run jq -r '.last_http_status' "$HOME/.cache/cosine-usage.meta.json"
  [ "$output" = "500" ]
  run jq -r '.last_success_at' "$HOME/.cache/cosine-usage.meta.json"
  [ "$output" = "1700000000" ]
}

@test "rejects a zero or invalid total in the cache" {
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":1,"totalAvailableTokens":0,"billingPeriodResetsAt":"2099-01-01T00:00:00Z"}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$COSINE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid Cosine usage cache"* ]]
}
