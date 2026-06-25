#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

setup() {
  setup_test_home
  mkdir -p "$HOME/.local/state/tmux"
}

@test "tmux-usage reports counts without non-portable column flags" {
  local log="$HOME/.local/state/tmux/usage.jsonl"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat >"$log" <<EOF
{"ts":"$ts","key":"g","name":"lazygit","session":"main","window":"1","pane":"1","path":"$HOME","host":"host"}
{"ts":"$ts","key":"g","name":"lazygit","session":"main","window":"1","pane":"1","path":"$HOME","host":"host"}
{"ts":"$ts","key":"a","name":"ai-usage","session":"main","window":"1","pane":"1","path":"$HOME","host":"host"}
EOF

  run zsh --no-rcs "$FUNCTIONS_DIR/tmux/tmux-usage"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BINDING"* ]]
  [[ "$output" == *"lazygit"*"2"*"2"*"2"*"2"* ]]
  [[ "$output" == *"ai-usage"*"1"*"1"*"1"*"1"* ]]
}
