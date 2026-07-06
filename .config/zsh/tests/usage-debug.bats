#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

USAGE_DEBUG="$FUNCTIONS_DIR/usage-debug"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
}

@test "prints Cosine cache backoff trigger and credit usage details" {
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":720,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-20T00:00:00Z"}
EOF
  next_retry=$(($(date +%s) + 120))
  jq -n --argjson n "$next_retry" \
    '{next_retry_at:$n, fail_count:2, last_http_status:"500", last_error:"server boom", last_success_at:1700000000}' \
    >"$HOME/.cache/cosine-usage.meta.json"
  : >"$HOME/.cache/cosine-usage.trigger"

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Cosine"* ]]
  [[ "$output" == *".cache/cosine-usage.json"* ]]
  [[ "$output" == *"backoff: fail_count=2"* ]]
  [[ "$output" == *"last: status=500, error=server boom"* ]]
  [[ "$output" == *"trigger: age="*".cache/cosine-usage.trigger"* ]]
  [[ "$output" == *"usage: credits=720/1k (72%) reset in"* ]]
}
