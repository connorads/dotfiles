#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

USAGE_DEBUG="$FUNCTIONS_DIR/usage-debug"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
}

# usage-debug calls `date +%s` unconditionally - there is no AI_USAGE_NOW
# equivalent - so these assert on the window LABEL, which is clock-independent,
# and keep every reset far enough out that seconds of skew cannot move the
# _fmt_secs bucket.

@test "codex usage names a window by its real duration, not its JSON slot" {
  # Today's live shape: the 5h window is off for Pro, so the account's only
  # window is the weekly one and it arrives in the primary_window slot. Reading
  # that slot positionally printed `5h=14% reset in 6d 11h` - a 5-hour window
  # resetting in six and a half days.
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":14,"limit_window_seconds":604800,"reset_after_seconds":559789},"secondary_window":null}}
EOF

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: 7d=14% reset in 6d"* ]]
  [[ "$output" != *"5h="* ]]
}

@test "codex reads the payload's absolute reset instant over its countdown" {
  # reset_after_seconds was true when the cache was written; reset_at is the
  # instant itself. The two disagree by design here, so whichever is used shows.
  reset_at=$(($(date +%s) + 559789))
  jq -n --argjson r "$reset_at" \
    '{rate_limit:{primary_window:{used_percent:14,limit_window_seconds:604800,reset_after_seconds:60,reset_at:$r},secondary_window:null}}' \
    >"$HOME/.cache/codex-usage.json"

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: 7d=14% reset in 6d"* ]]
}

@test "codex renders a window in the secondary slot without fabricating a zero" {
  # The dangerous shape the old `// 0` produced: a 5h window alone in the
  # secondary slot read as `5h=0% reset in 0m` - headroom, at 37% used.
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":null,"secondary_window":{"used_percent":37,"limit_window_seconds":18000,"reset_after_seconds":9000}}}
EOF

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: 5h=37% reset in 2h"* ]]
  [[ "$output" != *"=0%"* ]]
}

@test "codex prints no usage line when the payload carries no window" {
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":null,"secondary_window":null}}
EOF

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Codex"* ]]
  [[ "$output" != *"usage:"* ]]
}

@test "claude reports its weekly window alongside the 5-hour one" {
  # Only .five_hour was read, so the weekly Claude figure never appeared.
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":64,"resets_at":"2099-01-01T02:00:00Z"},
 "seven_day":{"utilization":25,"resets_at":"2099-01-05T00:00:00Z"}}
EOF

  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: 5h=64% reset in"* ]]
  [[ "$output" == *"usage: 7d=25% reset in"* ]]
}

@test "prints Cosine cache backoff and credit usage details" {
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":720,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-20T00:00:00Z"}
EOF
  next_retry=$(($(date +%s) + 120))
  jq -n --argjson n "$next_retry" \
    '{next_retry_at:$n, fail_count:2, last_http_status:"500", last_error:"server boom", last_success_at:1700000000}' \
    >"$HOME/.cache/cosine-usage.meta.json"
  run_zsh_function "$USAGE_DEBUG"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Cosine"* ]]
  [[ "$output" == *".cache/cosine-usage.json"* ]]
  [[ "$output" == *"backoff: fail_count=2"* ]]
  [[ "$output" == *"last: status=500, error=server boom"* ]]
  [[ "$output" == *"usage: credits=720/1k (72%) reset in"* ]]
}
