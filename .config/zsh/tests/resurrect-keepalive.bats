#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it:
# the script under test and the real tmux-resurrect plugin (whose save.sh the
# keepalive drives). The plugin dir is passed back in via RESURRECT_PLUGIN_DIR so
# the isolated HOME need not carry a copy of the plugin.
KEEPALIVE="$HOME/.config/tmux/scripts/resurrect-keepalive.sh"
REAL_PLUGIN_DIR="$HOME/.config/tmux/plugins/tmux-resurrect"

# The keepalive targets tmux's *default socket* (it strips TMUX). The test
# isolates that socket per-test via TMUX_TMPDIR and starts a bare default-socket
# server there, so the keepalive's default socket IS this throwaway server. tmux
# is symlinked onto the minimal test PATH so the keepalive's bare `tmux`
# resolves; TMUX is unset so `tmux` can't reattach to the dev's outer server.
setup() {
  setup_test_home
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  unset TMUX
  # Short TMUX_TMPDIR under /tmp: the AF_UNIX socket path (TMUX_TMPDIR/tmux-UID/
  # default) must stay under ~104 chars, which the long macOS BATS_TEST_TMPDIR
  # blows. Per-test unique; left for system /tmp cleanup.
  export TMUX_TMPDIR="/tmp/rka-$$-${BATS_TEST_NUMBER}"
  mkdir -p "$TMUX_TMPDIR"
  ln -sf "$TMUX_BIN" "$TEST_BIN/tmux"

  export RESURRECT_PLUGIN_DIR="$REAL_PLUGIN_DIR"
  export RESURRECT_KEEPALIVE_LOG="$BATS_TEST_TMPDIR/keepalive.log"

  SAVE_DIR="$HOME/.local/share/tmux/resurrect"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && "$TMUX_BIN" kill-server 2>/dev/null || true
}

start_server() {
  "$TMUX_BIN" -f /dev/null new-session -d -s s -x 80 -y 24
}

# A stub plugin whose save.sh does nothing (or fails), so the keepalive's own run
# can't refresh the newest-save age — letting the staleness branch be exercised
# deterministically instead of racing a real save's fresh mtime.
stub_plugin() {
  local rc="${1:-0}" err="${2:-}"
  local dir="$BATS_TEST_TMPDIR/stub-plugin/scripts"
  mkdir -p "$dir"
  {
    echo '#!/usr/bin/env bash'
    [ -n "$err" ] && echo "echo '$err' >&2"
    echo "exit $rc"
  } >"$dir/save.sh"
  chmod +x "$dir/save.sh"
  export RESURRECT_PLUGIN_DIR="$BATS_TEST_TMPDIR/stub-plugin"
}

aged_save() {
  mkdir -p "$SAVE_DIR"
  touch -t 200001010000 "$SAVE_DIR/tmux_resurrect_old.txt"
}

stale_opt() { "$TMUX_BIN" show -gv @resurrect_stale 2>/dev/null; }

# --- no server: skip cleanly, not an error --------------------------------

@test "no server: logs skip and exits 0 without saving" {
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  grep -q "no server, skip" "$RESURRECT_KEEPALIVE_LOG"
  [ ! -d "$SAVE_DIR" ] || ! compgen -G "$SAVE_DIR/tmux_resurrect_*.txt" >/dev/null
}

# --- happy path: real save.sh writes a file, no alarm ---------------------

@test "server up: drives a real save, logs saved ok, clears the stale flag" {
  start_server
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  compgen -G "$SAVE_DIR/tmux_resurrect_*.txt" >/dev/null
  grep -q "saved ok age=.*state=FRESH" "$RESURRECT_KEEPALIVE_LOG"
  [ "$(stale_opt)" = "0" ]
}

# --- staleness alarm: aged save + a no-op save can't refresh it -----------

@test "stale newest save: sets @resurrect_stale=1 and logs the alarm" {
  start_server
  aged_save
  stub_plugin 0
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  [ "$(stale_opt)" = "1" ]
  grep -q "ALARM stale" "$RESURRECT_KEEPALIVE_LOG"
}

# --- NONE alarm: server up but no save file at all ------------------------

@test "no save file: alarms with the no-save-file message" {
  start_server
  stub_plugin 0
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  [ "$(stale_opt)" = "1" ]
  grep -q "no save file" "$RESURRECT_KEEPALIVE_LOG"
}

# --- clear path: aged file but the stale line is far out ------------------

@test "aged save under a raised stale line stays FRESH-side and clears the flag" {
  start_server
  aged_save
  stub_plugin 0
  RESURRECT_AGING_SECS=999999999 RESURRECT_STALE_SECS=999999999 run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  [ "$(stale_opt)" = "0" ]
}

# --- error capture: save.sh failure is logged, not swallowed --------------

@test "save.sh failure logs SAVE FAILED with rc and stderr" {
  start_server
  stub_plugin 3 "disk full boom"
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  grep -q "SAVE FAILED rc=3" "$RESURRECT_KEEPALIVE_LOG"
  grep -q "disk full boom" "$RESURRECT_KEEPALIVE_LOG"
}
