#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

STATUS_RIGHT="$HOME/.config/tmux/scripts/status-right.sh"

# NOTE: bats runs under macOS bash 3.2, where a false `[[ ]]` mid-test does
# NOT trigger errexit - only the test's *last* command fails it. Every
# non-final `[[ ]]` assertion therefore carries `|| false` (a plain command,
# which errexit does honour) so it can actually fail the test.

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
  write_stub vm_stat <<'EOF'
#!/usr/bin/env bash
cat <<'STATS'
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                               98.
Pages active:                              2.
Pages inactive:                            0.
Pages speculative:                         0.
Pages wired down:                          0.
Pages purgeable:                           0.
File-backed pages:                         0.
Pages occupied by compressor:              0.
STATS
EOF
  write_stub timeout <<'EOF'
#!/usr/bin/env bash
shift
exec "$@"
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

stub_attention_elsewhere() {
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
case "$1" in
  show-option) exit 0 ;;
  list-panes) printf 'current idle\nother done\n' ;;
esac
EOF
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
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$HOME/.cache/tmux-cpu-percentage" ] && break
    sleep 0.1
  done
  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  # cpu stub → 1%, ram stub → 2%; both pills present side by side at width >=80.
  [[ "$plain" == *"1%"* ]] || false
  [[ "$plain" == *"2%"* ]]
}

@test "wide status marks memory pill as a tappable user range" {
  run_status_right 90

  [ "$status" -eq 0 ]
  [[ "$output" == *"#[range=user|mem]"* ]] || false
  [[ "$output" == *"#[norange]"* ]]
}

@test "cross-session badge is a sub-80 overflow fallback" {
  stub_attention_elsewhere

  for width in 79 44 34; do
    run_status_right "$width" current
    [ "$status" -eq 0 ]
    [[ "$output" == *"#[range=user|agents]"* ]]
  done

  run_status_right 80 current
  [ "$status" -eq 0 ]
  [[ "$output" != *"#[range=user|agents]"* ]]
}

@test "hostname shows the distinctive tail, not a shared prefix" {
  # Connors-MacBook-Air / Connors-Mac-mini share "Connors-"; the tail is what
  # tells the machines apart, so print that — never collapse to "Conno…".
  run bash "$STATUS_RIGHT" 90 "$BATS_TEST_TMPDIR" "Connors-MacBook-Air" "Connors-MacBook-Air.local" ""
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"Air"* ]] || false
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
shift
for key in "$@"; do
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo 1 ;;
    vm.swapusage) echo "total = 4096.00M  used = 2662.40M  free = 100.00M  (encrypted)" ;;
  esac
done
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
shift
for key in "$@"; do
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo 2 ;;
    vm.swapusage) echo "total = 4096.00M  used = 3000.00M  free = 100.00M  (encrypted)" ;;
  esac
done
EOF

  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"▲"* ]] || false
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
  [[ "$plain" == *" - "* ]] || false
  [[ "$plain" != *"dotfiles-test"* ]]
}

@test "git segment is cached per pane path and recomputed after the TTL" {
  repo="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$repo"
  git init -q -b git-cache-test "$repo"
  git -C "$repo" config user.email "bats@example.com"
  git -C "$repo" config user.name "Bats Test"
  printf 'tracked\n' >"$repo/file"
  git -C "$repo" add file
  git -C "$repo" commit -q -m initial

  run_status_right_for_path 45 "$repo"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" git-cache-test "* ]] || false

  # Dirty the repo: a render inside the TTL serves the cached clean value (the
  # point of the cache - pane switches re-fire renders and paid 4 git forks
  # each), an aged cache recomputes and shows the dirty marker.
  printf 'changed\n' >"$repo/file"

  run_status_right_for_path 45 "$repo"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" git-cache-test "* ]] || false

  touch -t 202001010000 "$HOME"/.cache/tmux-git-branch-*

  run_status_right_for_path 45 "$repo"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" git-cache-test* "* ]]
}

@test "git segment caches are keyed per pane path" {
  init_dotfiles_repo
  repo="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$repo"
  git init -q -b other-branch "$repo"
  printf 'tracked\n' >"$repo/file"
  git -C "$repo" add file
  git -C "$repo" -c user.email=bats@example.com -c user.name=Bats commit -q -m initial

  run_status_right_for_path 45 "$HOME"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" dotfiles-test"* ]] || false

  # A different pane path must not be served $HOME's cached branch.
  run_status_right_for_path 45 "$repo"
  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *" other-branch"* ]] || false
  [[ "$plain" != *"dotfiles-test"* ]]
}

@test "ssh segment reports both directions from a single lsof query" {
  write_stub uname <<'EOF'
#!/usr/bin/env bash
echo Darwin
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
echo x >>"$TEST_LOG"
echo "sshd 100 u 3u IPv4 0x0 0t0 TCP 10.0.0.1:22->10.0.0.2:50000"
echo "ssh 200 u 3u IPv4 0x0 0t0 TCP 10.0.0.1:50001->10.0.0.9:22"
EOF

  run_status_right 45

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"1↓1↑"* ]] || false
  # lsof blocks on network-fs mounts; both direction counts must come from one
  # capture, not one query per direction.
  [ "$(wc -l <"$TEST_LOG" | tr -d ' ')" -eq 1 ]
}

@test "cpu sampler runs once within the cache TTL and leaves no temp files" {
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
echo x >>"$TEST_LOG"
printf '7%%'
EOF

  run_status_right 90
  [ "$status" -eq 0 ]
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$HOME/.cache/tmux-cpu-percentage" ] && break
    sleep 0.1
  done
  run_status_right 90
  [ "$status" -eq 0 ]

  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"7%"* ]] || false
  # Second render within the 15s TTL must hit the cache, not re-run the ~1s
  # blocking iostat sampler.
  [ "$(wc -l <"$TEST_LOG" | tr -d ' ')" -eq 1 ]
  # The cache write is tmp-file + rename (a reader never sees a torn value);
  # the tmp file must not linger.
  run bash -c 'ls "$HOME"/.cache/tmux-cpu-percentage.tmp.* 2>/dev/null'
  [ -z "$output" ]
}

@test "stale cpu cache returns immediately while one sampler refreshes it" {
  printf '3%%' >"$HOME/.cache/tmux-cpu-percentage"
  touch -t 202001010000 "$HOME/.cache/tmux-cpu-percentage"
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
echo x >>"$TEST_LOG"
sleep 1
printf '9%%'
EOF

  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"3%"* ]] || false
  [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "3%" ]
  sleep 1.2
  [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "9%" ]
  [ "$(wc -l <"$TEST_LOG" | tr -d ' ')" -eq 1 ]
}

@test "concurrent stale renders launch only one cpu sampler" {
  printf '3%%' >"$HOME/.cache/tmux-cpu-percentage"
  touch -t 202001010000 "$HOME/.cache/tmux-cpu-percentage"
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
echo x >>"$TEST_LOG"
sleep 0.3
printf '8%%'
EOF

  bash "$STATUS_RIGHT" 90 "$BATS_TEST_TMPDIR" host host.local "" "" >/dev/null &
  first=$!
  bash "$STATUS_RIGHT" 90 "$BATS_TEST_TMPDIR" host host.local "" "" >/dev/null &
  second=$!
  wait "$first" "$second"
  sleep 0.5

  [ "$(wc -l <"$TEST_LOG" | tr -d ' ')" -eq 1 ]
  [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "8%" ]
}

@test "failed cpu sampler keeps the last good value and clears its lock" {
  printf '3%%' >"$HOME/.cache/tmux-cpu-percentage"
  touch -t 202001010000 "$HOME/.cache/tmux-cpu-percentage"
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
exit 9
EOF

  run_status_right 90
  [ "$status" -eq 0 ]
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ ! -d "$HOME/.cache/tmux-cpu-percentage.lock" ] && break
    sleep 0.1
  done

  [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "3%" ]
  [ ! -d "$HOME/.cache/tmux-cpu-percentage.lock" ]
}

@test "stale cpu lock is reclaimed" {
  printf '3%%' >"$HOME/.cache/tmux-cpu-percentage"
  touch -t 202001010000 "$HOME/.cache/tmux-cpu-percentage"
  mkdir "$HOME/.cache/tmux-cpu-percentage.lock"
  touch -t 202001010000 "$HOME/.cache/tmux-cpu-percentage.lock"
  write_executable "$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh" <<'EOF'
#!/usr/bin/env bash
printf '8%%'
EOF

  run_status_right 90
  [ "$status" -eq 0 ]
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "8%" ] && break
    sleep 0.1
  done

  [ "$(cat "$HOME/.cache/tmux-cpu-percentage")" = "8%" ]
  [ ! -d "$HOME/.cache/tmux-cpu-percentage.lock" ]
}

@test "memory status gathers pressure and swap once" {
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
shift
for key in "$@"; do
  echo "$key" >>"$TEST_LOG"
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo 1 ;;
    vm.swapusage) echo "total = 4096.00M  used = 2662.40M  free = 100.00M" ;;
  esac
done
EOF

  run_status_right 90

  [ "$status" -eq 0 ]
  [ "$(grep -c '^kern.memorystatus_vm_pressure_level$' "$TEST_LOG")" -eq 1 ]
  [ "$(grep -c '^vm.swapusage$' "$TEST_LOG")" -eq 1 ]
}

@test "wide status omits AI usage even when caches exist" {
  seed_usage_caches

  run_status_right 180

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" != *"C:"* ]] || false
  [[ "$plain" != *"X:"* ]] || false
  [[ "$plain" != *"S:"* ]]
}

# --- vox pill: one capture, from start to read ------------------------------
#
# Additions here stay on the pure renderer: this file is already the suite's
# most expensive, so no test below starts a capture or spends real time.

# vox_recording SECONDS_AGO - a live capture the pill can render.
vox_recording() {
  sleep 100 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/vox-pids"
  printf '%s %s %s\n' "$!" "$(($(date +%s) - $1))" "$HOME/rec" \
    >"$HOME/.cache/tmux-vox.state"
}

vox_transcribing() {
  sleep 100 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/vox-pids"
  printf '%s %s %s\n' "$!" "$(($(date +%s) - $1))" "$HOME/rec" \
    >"$HOME/.cache/tmux-vox.job"
}

reap_vox() {
  [ -f "$BATS_TEST_TMPDIR/vox-pids" ] || return 0
  while read -r pid; do kill "$pid" 2>/dev/null || true; done <"$BATS_TEST_TMPDIR/vox-pids"
}

@test "vox pill is hidden while nothing is recorded or waiting" {
  run_status_right 90

  [ "$status" -eq 0 ]
  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" != *"~ "* ]]
}

@test "vox pill shows elapsed capture time" {
  vox_recording 720
  run_status_right 90
  reap_vox

  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"~ 12m"* ]] || false
  [[ "$output" == *"#[fg=#a6adc8]"* ]]
}

@test "vox pill is a tappable user range" {
  vox_recording 720
  run_status_right 90
  reap_vox

  # Clicking it opens a menu whose rows match the state; the range is what
  # MouseDown1Status keys on.
  [[ "$output" == *"#[range=user|vox]"* ]] || false
  [[ "$output" == *"#[norange]"* ]]
}

@test "vox pill follows the capture into transcription" {
  # 90 s, not 40: a seconds-scale token would tick between the fixture and the
  # render, which this file's cold first run is slow enough to do.
  vox_transcribing 90
  run_status_right 90
  reap_vox

  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"≈ 1m"* ]] || false
  # Still ambient: transcription is ongoing work, not news.
  [[ "$output" == *"#[fg=#a6adc8]"* ]]
}

@test "vox pill counts finished transcripts in the unread blue" {
  mkdir -p "$HOME/Recordings/vox/2026-07-28-140312"
  printf '[00:00:00] Me: hello\n' >"$HOME/Recordings/vox/2026-07-28-140312/transcript.md"

  run_status_right 90

  plain=$(printf '%s' "$output" | strip_tmux_styles)
  [[ "$plain" == *"✓ 1"* ]] || false
  # The same blue the agent dots use for "finished, not looked at yet".
  [[ "$output" == *"#[fg=#89b4fa]"* ]]
}
