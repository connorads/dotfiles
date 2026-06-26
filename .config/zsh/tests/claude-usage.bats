#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CLAUDE_USAGE="$FUNCTIONS_DIR/claude-usage"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
}

# Seed the meta file: next_retry_at fail_count last_success_at
seed_meta() {
  jq -n --argjson n "$1" --argjson f "$2" --argjson s "$3" \
    '{next_retry_at:$n, fail_count:$f, last_http_status:"", last_error:"", last_success_at:$s}' \
    >"$HOME/.cache/claude-usage.meta.json"
}

@test "renders all windows on a fresh cache hit" {
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":42,"resets_at":"2099-01-01T00:00:00Z"},
 "seven_day":{"utilization":7,"resets_at":"2099-01-02T00:00:00Z"},
 "seven_day_sonnet":{"utilization":13,"resets_at":"2099-01-03T00:00:00Z"},
 "extra_usage":{"is_enabled":true,"monthly_limit":5000,"used_credits":1234}}
EOF
  seed_meta 9999999999 0 0

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"5-hour:"* ]]
  [[ "$output" == *"42%"* ]]
  [[ "$output" == *"7-day:"* ]]
  [[ "$output" == *"resets in"* ]]
  [[ "$output" == *"Sonnet:"* ]]
  [[ "$output" == *"Extra:"* ]]
  [[ "$output" == *"12.34/50.00"* ]]
  [[ "$output" == *"enabled"* ]]
}

@test "shows cache stale when the window reset and the cache is old" {
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":42,"resets_at":"2000-01-01T00:00:00Z"},
 "seven_day":{"utilization":7,"resets_at":"2000-01-02T00:00:00Z"}}
EOF
  touch -t 202001010000 "$HOME/.cache/claude-usage.json"
  seed_meta 9999999999 0 0

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"cache stale"* ]]
}

@test "reports paused refresh when there is no cache and retry is in the future" {
  seed_meta 9999999999 0 0

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]
}

@test "prints login guidance when no credentials are available" {
  seed_meta 0 0 0
  write_stub security <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Not logged in"* ]]
}

@test "falls back to the credentials file when the keychain is empty" {
  seed_meta 0 0 0
  # macOS keychain item present but empty (recent Claude Code stores the
  # token in the file, leaving the keychain blank) — must not read as logged out.
  write_stub security <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  mkdir -p "$HOME/.claude"
  cat >"$HOME/.claude/.credentials.json" <<'EOF'
{"claudeAiOauth":{"accessToken":"file-tok"}}
EOF
  write_stub claude <<'EOF'
#!/usr/bin/env bash
echo "1.2.3 (Claude Code)"
EOF
  write_curl_stub
  cat >"$BATS_TEST_TMPDIR/body200.json" <<'EOF'
{"five_hour":{"utilization":42,"resets_at":"2099-01-01T00:00:00Z"},
 "seven_day":{"utilization":7,"resets_at":"2099-01-02T00:00:00Z"}}
EOF
  export CURL_1_KIND=hb CURL_1_CODE=200 CURL_1_BODY="$BATS_TEST_TMPDIR/body200.json"

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 0 ]
  [[ "$output" != *"Not logged in"* ]]
  [[ "$output" == *"5-hour:"* ]]
  [[ "$output" == *"42%"* ]]
  [ -f "$HOME/.cache/claude-usage.json" ]
}

@test "records backoff in meta on an HTTP failure" {
  seed_meta 0 0 1700000000
  write_stub security <<'EOF'
#!/usr/bin/env bash
echo '{"claudeAiOauth":{"accessToken":"tok"}}'
EOF
  write_stub claude <<'EOF'
#!/usr/bin/env bash
echo "1.2.3 (Claude Code)"
EOF
  write_curl_stub
  printf '{"error":{"message":"server boom"}}' >"$BATS_TEST_TMPDIR/body500.json"
  export CURL_1_KIND=hb CURL_1_CODE=500 CURL_1_BODY="$BATS_TEST_TMPDIR/body500.json"

  run_zsh_function "$CLAUDE_USAGE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage refresh paused for"* ]]

  run jq -r '.fail_count' "$HOME/.cache/claude-usage.meta.json"
  [ "$output" = "1" ]
  run jq -r '.last_error' "$HOME/.cache/claude-usage.meta.json"
  [ "$output" = "server boom" ]
  run jq -r '.last_http_status' "$HOME/.cache/claude-usage.meta.json"
  [ "$output" = "500" ]
  run jq -r '.last_success_at' "$HOME/.cache/claude-usage.meta.json"
  [ "$output" = "1700000000" ]
}
