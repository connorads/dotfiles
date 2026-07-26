#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

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
  # Host isolation: print_full renders real disk% (df) and battery% (pmset), so
  # stub both like the cpu/ram plugin scripts above.
  write_stub df <<'EOF'
#!/usr/bin/env bash
# Header only: disk_percentage() finds no NR==2 row and renders "-" (no number).
echo "Filesystem Size Used Avail Use% Mounted on"
EOF
  write_stub pmset <<'EOF'
#!/usr/bin/env bash
# No "InternalBattery" line: battery_percentage() returns early, no segment.
echo "Now drawing from 'AC Power'"
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
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":400,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-20T00:00:00Z"}
EOF
  touch "$HOME/.cache/claude-usage.json" "$HOME/.cache/codex-usage.json" "$HOME/.cache/cosine-usage.json"
}

@test "wide status shows both cpu and the ram percentage pill" {
  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  # cpu stub → 1%, ram stub → 2%; both pills present side by side at width >=80.
  [[ "$plain" == *"1%"* ]]
  [[ "$plain" == *"2%"* ]]
}

@test "wide status marks memory pill as a tappable user range" {
  run_status_right 90

  [ "$status" -eq 0 ]
  [[ "$output" == *"#[range=user|mem]"* ]]
  [[ "$output" == *"#[norange]"* ]]
}

@test "hostname shows the distinctive tail, not a shared prefix" {
  # Connors-MacBook-Air / Connors-Mac-mini share "Connors-"; the tail is what
  # tells the machines apart, so print that — never collapse to "Conno…".
  run bash "$STATUS_RIGHT" 90 "$BATS_TEST_TMPDIR" "Connors-MacBook-Air" "Connors-MacBook-Air.local" ""
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"Air"* ]]
  [[ "$plain" != *"Conno"* ]]
}

@test "short hostname prints whole" {
  run bash "$STATUS_RIGHT" 45 "$BATS_TEST_TMPDIR" "rpi5" "rpi5.local" ""
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"rpi5"* ]]
}

@test "full-hostname flag overrides trailing-segment shortening" {
  run bash "$STATUS_RIGHT" 90 "$BATS_TEST_TMPDIR" "Connors-MacBook-Air" "Connors-MacBook-Air.local" "1"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"Connors-MacBook-Air"* ]]
}

@test "healthy memory-pressure pill still shows the swap figure" {
  # Normal pressure + 2.6G swap (below the 5G / 5120 MB BUSY threshold) → OK
  # state. The figure is shown even when healthy so the resting baseline stays
  # visible.
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
case "$2" in
  kern.memorystatus_vm_pressure_level) echo 1 ;;
  vm.swapusage) echo "total = 4096.00M  used = 2662.40M  free = 100.00M  (encrypted)" ;;
esac
EOF

  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"2.6G"* ]]
}

@test "pressure-driven memory pill shows the cause marker, not a swap figure" {
  # Warn pressure + idle-band swap (3G, below the 5G line) → BUSY driven by
  # pressure. The figure slot shows ▲ (swap is fine, look elsewhere), no G figure.
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
case "$2" in
  kern.memorystatus_vm_pressure_level) echo 2 ;;
  vm.swapusage) echo "total = 4096.00M  used = 3000.00M  free = 100.00M  (encrypted)" ;;
esac
EOF

  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"▲"* ]]
  [[ "$plain" != *"3.0G"* ]]
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

@test "wide status omits AI usage even when caches exist" {
  seed_usage_caches

  run_status_right 180

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" != *"C:"* ]]
  [[ "$plain" != *"X:"* ]]
  [[ "$plain" != *"S:"* ]]
}
