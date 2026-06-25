#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

STATUS_RIGHT="$HOME/.config/tmux/scripts/status-right.sh"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/tmux/plugins/tmux-cpu/scripts"
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
printf '1%%'
EOF
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/ram_percentage.sh" <<'EOF'
#!/usr/bin/env bash
printf '2%%'
EOF
}

strip_tmux_styles() {
  sed -E 's/#\[[^]]*\]//g'
}

run_status_right() {
  local width="$1"
  shift

  run bash "$STATUS_RIGHT" "$width" "$BATS_TEST_TMPDIR" "host" "host.local" "" "$@"
}

seed_usage_caches() {
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":4,"resets_at":"2099-01-01T02:00:00Z"},
 "seven_day":{"utilization":38,"resets_at":"2099-01-05T00:00:00Z"}}
EOF
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":10,"reset_after_seconds":10800},
 "secondary_window":{"used_percent":86,"reset_after_seconds":216000}}}
EOF
  touch "$HOME/.cache/claude-usage.json" "$HOME/.cache/codex-usage.json"
}

@test "wide status groups each usage with its reset" {
  seed_usage_caches

  run_status_right 180

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"C:4%·"*" 38%·"*d* ]]
  [[ "$plain" == *" │ X:10%·3h 86%·2d"* ]]
}

@test "medium-wide status groups weekly usage with weekly reset" {
  seed_usage_caches

  run_status_right 110

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"C:4%·"*" 38%·"*d* ]]
  [[ "$plain" == *" │ X:10%·3h 86%·2d"* ]]
}

@test "narrow full status keeps the previous 5-hour-only shape" {
  seed_usage_caches

  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"C:4%·"* ]]
  [[ "$plain" == *"X:10%·3h"* ]]
  [[ "$plain" != *" 38%"* ]]
  [[ "$plain" != *" 86%"* ]]
}

@test "missing weekly fields fall back to 5-hour-only provider output" {
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":4,"resets_at":"2099-01-01T02:00:00Z"}}
EOF
  cat >"$HOME/.cache/codex-usage.json" <<'EOF'
{"rate_limit":{"primary_window":{"used_percent":10,"reset_after_seconds":10800}}}
EOF

  run_status_right 180

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"C:4%·"* ]]
  [[ "$plain" == *"X:10%·3h"* ]]
  [[ "$plain" != *" 38%"* ]]
  [[ "$plain" != *" 86%"* ]]
}

@test "expired stale windows render stale instead of negative reset times" {
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":90,"resets_at":"2000-01-01T00:00:00Z"},
 "seven_day":{"utilization":95,"resets_at":"2000-01-02T00:00:00Z"}}
EOF
  touch -t 202001010000 "$HOME/.cache/claude-usage.json"

  run_status_right 180

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"C:90%·stale 95%·stale"* ]]
}
