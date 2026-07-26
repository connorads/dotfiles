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

# A stub plugin whose save.sh writes a *state-only* save and repoints `last` at
# it — a fresh file with no panes, exactly what the locale bug produced. Freshness
# alone reads FRESH here, so only the content check can catch it.
stub_plugin_empty_save() {
  local dir="$BATS_TEST_TMPDIR/empty-plugin/scripts"
  mkdir -p "$dir"
  cat >"$dir/save.sh" <<'EOF'
#!/usr/bin/env bash
save_dir="$HOME/.local/share/tmux/resurrect"
mkdir -p "$save_dir"
printf 'state\tmain\t\n' >"$save_dir/tmux_resurrect_empty.txt"
ln -sf tmux_resurrect_empty.txt "$save_dir/last"
EOF
  chmod +x "$dir/save.sh"
  export RESURRECT_PLUGIN_DIR="$BATS_TEST_TMPDIR/empty-plugin"
}

# An aged but otherwise *valid* save (it carries a pane line, and `last` points at
# it), so the freshness tests exercise the age dimension alone rather than also
# tripping the pane-count check.
aged_save() {
  mkdir -p "$SAVE_DIR"
  printf 'pane\ts\t1\t1\t:*\t1\t:t\t:%s\t1\tzsh\t:zsh\n' "$HOME" >"$SAVE_DIR/tmux_resurrect_old.txt"
  ln -sf tmux_resurrect_old.txt "$SAVE_DIR/last"
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
  grep -q "saved ok panes=.*state=FRESH" "$RESURRECT_KEEPALIVE_LOG"
  [ "$(stale_opt)" = "0" ]
}

# --- locale: tabs survive a locale-less environment ------------------------

# Outside a UTF-8 locale tmux sanitises tabs in format output to `_`, and launchd
# starts the agent with no locale at all. Everything downstream is tab-delimited,
# so save.sh then reads an empty session_name, treats every pane as belonging to a
# grouped session, and skips it — a state-only save with no panes or windows.
@test "locale-less environment still saves panes and windows" {
  start_server
  run env -u LANG -u LC_ALL -u LC_CTYPE bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  grep -q '^pane' "$SAVE_DIR/last"
  grep -q '^window' "$SAVE_DIR/last"
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

# --- content check: a fresh but pane-less save alarms ---------------------

@test "pane-less save alarms even though the file is fresh" {
  start_server
  stub_plugin_empty_save
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  [ "$(stale_opt)" = "1" ]
  grep -q "SAVE EMPTY panes=0" "$RESURRECT_KEEPALIVE_LOG"
  grep -q "save has no panes" "$RESURRECT_KEEPALIVE_LOG"
}

@test "healthy save logs its pane count" {
  start_server
  run bash "$KEEPALIVE"
  [ "$status" -eq 0 ]
  grep -qE "saved ok panes=[1-9][0-9]* age=" "$RESURRECT_KEEPALIVE_LOG"
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
