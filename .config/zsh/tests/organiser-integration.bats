#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

ORG="$HOME/.config/tmux/scripts/organiser.sh"

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="organiser_${BATS_TEST_NUMBER}_$$"
  TEST_BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$TEST_BIN"
  cat >"$TEST_BIN/tmux" <<EOF
#!/usr/bin/env bash
exec "$TMUX_BIN" -L "$SOCK" "\$@"
EOF
  chmod +x "$TEST_BIN/tmux"
  export PATH="$TEST_BIN:$PATH"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s source -x 100 -y 30 'sleep 300'
  "$TMUX_BIN" -L "$SOCK" new-session -d -s dest 'sleep 300'
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && "$TMUX_BIN" -L "$SOCK" kill-server 2>/dev/null || true
}

tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

@test "window move background moves the live window to destination" {
  win="$(tx new-window -d -P -F '#{window_id}' -t source 'sleep 300')"
  dest_id="$(tx display-message -p -t dest '#{session_id}')"

  run "$ORG" action-window move-background client "$win" "$dest_id"

  [ "$status" -eq 0 ]
  tx list-windows -t dest -F '#{window_id}' | grep -Fxq "$win"
  ! tx list-windows -t source -F '#{window_id}' | grep -Fxq "$win"
}

@test "window share and unlink keep one live shared window" {
  win="$(tx new-window -d -P -F '#{window_id}' -t source 'sleep 300')"
  dest_id="$(tx display-message -p -t dest '#{session_id}')"

  run "$ORG" action-window share client "$win" "$dest_id"
  [ "$status" -eq 0 ]
  tx list-windows -t source -F '#{window_id}' | grep -Fxq "$win"
  tx list-windows -t dest -F '#{window_id}' | grep -Fxq "$win"

  idx="$(tx list-windows -t dest -F '#{window_id} #{window_index}' | awk -v w="$win" '$1 == w {print $2}')"
  tx unlink-window -t "dest:$idx"
  tx list-windows -t source -F '#{window_id}' | grep -Fxq "$win"
  ! tx list-windows -t dest -F '#{window_id}' | grep -Fxq "$win"
}

@test "pane break background creates a new destination window" {
  pane="$(tx split-window -P -F '#{pane_id}' -t source 'sleep 300')"
  dest_id="$(tx display-message -p -t dest '#{session_id}')"
  before="$(tx list-windows -t dest | wc -l | tr -d ' ')"

  run "$ORG" action-pane-break break-background client "$pane" "$dest_id"

  [ "$status" -eq 0 ]
  after="$(tx list-windows -t dest | wc -l | tr -d ' ')"
  [ "$after" -eq $((before + 1)) ]
  tx list-panes -a -F '#{pane_id}' | grep -Fxq "$pane"
}

@test "pane join moves marked pane into destination window" {
  src_pane="$(tx new-window -d -P -F '#{pane_id}' -t source 'sleep 300')"
  dst_pane="$(tx display-message -p -t dest '#{pane_id}')"
  tx select-pane -m -t "$src_pane"

  run "$ORG" action-pane-join right client "$src_pane" "$dst_pane"

  [ "$status" -eq 0 ]
  dst_window="$(tx display-message -p -t "$dst_pane" '#{window_id}')"
  tx list-panes -t "$dst_window" -F '#{pane_id}' | grep -Fxq "$src_pane"
}
