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

run_status_right_for_path() {
  local width="$1"
  local pane_path="$2"
  shift 2

  run bash "$STATUS_RIGHT" "$width" "$pane_path" "host" "host.local" "" "$@"
}

init_dotfiles_repo() {
  mkdir -p "$HOME/git"
  git init --bare "$HOME/git/dotfiles" >/dev/null
  git --git-dir="$HOME/git/dotfiles" symbolic-ref HEAD refs/heads/dotfiles-test
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" config user.email "bats@example.com"
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" config user.name "Bats Test"
  printf 'tracked\n' >"$HOME/.tracked-dotfile"
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" add .tracked-dotfile
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" commit -m "initial" >/dev/null
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

@test "home directory shows bare dotfiles branch" {
  init_dotfiles_repo

  run_status_right_for_path 45 "$HOME"

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" dotfiles-test"* ]]
}

@test "home directory marks bare dotfiles dirty" {
  init_dotfiles_repo
  printf 'changed\n' >"$HOME/.tracked-dotfile"

  run_status_right_for_path 45 "$HOME"

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" dotfiles-test*"* ]]
}

@test "dotfiles fallback is not used below home" {
  init_dotfiles_repo
  mkdir -p "$HOME/.config/tmux"

  run_status_right_for_path 45 "$HOME/.config/tmux"

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" - "* ]]
  [[ "$plain" != *"dotfiles-test"* ]]
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
