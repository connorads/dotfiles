#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

# Crash-regression gauntlet for the patched tmux render path.
#
# This file deliberately breaks the house rule in ./CLAUDE.md that tmux test
# servers start with `-f /dev/null`: its entire purpose is to drive the REAL
# ~/.config/tmux/tmux.conf (split status, dim styles, hooks, status-right.sh)
# plus the local nix patches (dim-inactive-panes, force-redraw-on-focus-change,
# split-status-top-bottom - two of which hook screen-redraw.c) through the tty
# redraw path of the exact installed binary. A patched redraw bug once
# coincided with losing a live agent server; this harness exists so that class
# of regression is caught by tests, not by losing panes. It runs under the real
# $HOME so status-right.sh and friends resolve; the config's agent journal is
# silenced via AGENT_JOURNAL_DISABLE so no events land in the shared
# ~/.local/state/agent-journal/.
#
# Shape: ONE shared server + pty client for the whole file (the real config
# costs ~2.8s per server start), tests ordered cheap -> historically risky,
# each ending in assert_alive. ensure_alive revives server/client if an
# earlier test crashed them, so one failure doesn't cascade. Overlay hygiene:
# any test that opens an overlay (popup, prompt, copy-mode, display-panes)
# must dismiss it before returning, or the shared client wedges every later
# test.
#
# Never touches the default socket: everything lives on a private -L socket.

tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup_file() {
  # Ordered escalation: later tests assume earlier ones ran first.
  export BATS_NO_PARALLELIZE_WITHIN_FILE=true
  export SMOKE_SKIP=""
  TMUX_BIN="${TMUX_BIN:-$(command -v tmux || true)}"
  [ -n "$TMUX_BIN" ] || {
    export SMOKE_SKIP="tmux not installed"
    return 0
  }
  command -v python3 >/dev/null 2>&1 || {
    export SMOKE_SKIP="python3 (pty) unavailable"
    return 0
  }
  [ -r "$HOME/.config/tmux/tmux.conf" ] || {
    export SMOKE_SKIP="real tmux.conf not found"
    return 0
  }
  export TMUX_BIN
  export SOCK="rendersmoke_$$"
  export LOG="$BATS_FILE_TMPDIR/client.log"
  start_server
  if ! start_client; then
    stop_private_server
    export SMOKE_SKIP="could not attach a pty client in this environment"
  fi
}

teardown_file() {
  reap_client
  stop_private_server
}

setup() {
  [ -z "${SMOKE_SKIP:-}" ] || skip "$SMOKE_SKIP"
  ensure_alive
}

# Keep pane processes alive independently of terminal input.
start_server() {
  AGENT_JOURNAL_DISABLE=1 "$TMUX_BIN" -L "$SOCK" -f "$HOME/.config/tmux/tmux.conf" \
    new-session -d -s SMOKE -x 80 -y 24 -- sh -c 'exec sleep 2147483647'
}

# Reuse the shared PTY driver so attachment works without a parent terminal.
# Snapshot logs before detaching: terminal teardown clears the screen.
start_client() {
  local log="${1:-$LOG}" result=0
  : >"$log"
  TERM=xterm-256color attach_pty_client SMOKE "$log" || result=$?
  echo "$ATTACH_PID" >"$BATS_FILE_TMPDIR/client.pid"
  return "$result"
}

reap_client() {
  local f
  for f in "$BATS_FILE_TMPDIR/client.pid"; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
    rm -f "$f"
  done
  return 0
}

# The regression this file exists for: a live server (or its drawing client)
# silently dying. A dropped client with a healthy server is still the "lost my
# pane" symptom, so all three checks matter.
assert_alive() {
  tx list-panes -a >/dev/null
  kill -0 "$(tx display-message -p '#{pid}')"
  [ -n "$(tx list-clients 2>/dev/null)" ]
}

# Revive server/client killed by a previous test so later tests still run
# meaningfully (the dead test already failed its own assert_alive).
ensure_alive() {
  if ! tx list-panes -a >/dev/null 2>&1; then
    reap_client
    start_server
  fi
  if [ -z "$(tx list-clients 2>/dev/null)" ]; then
    reap_client
    start_client || return 1
  fi
  return 0
}

floats_supported() { tx list-commands | grep -q '^new-pane'; }

# Reduce the session to its base sleep pane so every test starts from a known
# single-pane layout regardless of what an earlier (possibly failed) test left.
reset_panes() {
  local base p
  base=$(tx list-panes -t SMOKE -F '#{pane_id}' | head -n1)
  for p in $(tx list-panes -s -t SMOKE -F '#{pane_id}'); do
    [ "$p" = "$base" ] || tx kill-pane -t "$p" 2>/dev/null || true
  done
  tx select-pane -t "$base"
}

@test "baseline: real-config server and pty client are up" {
  [ "$(tx display-message -p '#{session_name}')" = SMOKE ]
  assert_alive
}

@test "float: create, floating flag set, kill" {
  floats_supported || skip "no floating-pane support in this tmux"
  reset_panes
  tx new-pane -- sh -c 'printf MARKERFLOAT; exec sleep 300'
  fp=$(tx display-message -p '#{pane_id}')
  [ "$(tx display-message -p -t "$fp" '#{pane_floating_flag}')" = 1 ]
  # ast-grep-ignore: no-hard-wait - letting the float render before it is torn down again
  sleep 0.3
  tx kill-pane -t "$fp"
  assert_alive
}

@test "float: full-size (client minus borders)" {
  floats_supported || skip "no floating-pane support in this tmux"
  reset_panes
  cw=$(tx display-message -p '#{client_width}')
  ch=$(tx display-message -p '#{client_height}')
  # Full-size float: the window is already client minus the two status rows;
  # the float border needs one cell each side on top of that.
  tx new-pane -x $((cw - 2)) -y $((ch - 4)) -- sh -c 'exec sleep 300'
  fp=$(tx display-message -p '#{pane_id}')
  [ "$(tx display-message -p -t "$fp" '#{pane_floating_flag}')" = 1 ]
  # ast-grep-ignore: no-hard-wait - letting the float render before it is torn down again
  sleep 0.3
  tx kill-pane -t "$fp"
  assert_alive
}

@test "focus: select-pane bounce drives the dim force-redraw patch" {
  reset_panes
  tx split-window -t SMOKE -- sh -c 'exec sleep 300'
  set -- $(tx list-panes -t SMOKE -F '#{pane_id}')
  p1=$1
  p2=$2
  for i in 1 2 3; do
    tx select-pane -t "$p1"
    sleep 0.1
    tx select-pane -t "$p2"
    sleep 0.1
  done
  tx kill-pane -t "$p2"
  assert_alive
}

@test "inactive consecutive colours cannot collide with the dimmed output cache" {
  command -v uv >/dev/null 2>&1 || skip "uv unavailable"
  reset_panes
  base=$(tx display-message -p '#{pane_id}')
  tx set-window-option window-style 'fg=#ffffff,bg=#18181f'
  tx respawn-pane -k -t "$base" -- sh -c 'printf "\033[38;2;200;200;200;48;2;200;200;200mCACHEA\033[38;2;138;138;140;48;2;138;138;140mCACHEB"; exec sleep 300'
  tx split-window -h -- sh -c 'exec sleep 300'
  reap_client
  cache_log="$BATS_FILE_TMPDIR/cache.log"
  start_client "$cache_log"
  wait_until -i 0.1 'grep -q CACHEB "$cache_log"'
  cp "$cache_log" "$BATS_FILE_TMPDIR/cache.snap"
  size=$(tx display-message -p '#{client_width} #{client_height}')
  # A dims to #8a8a8c, exactly B's original colour. B must dim again.
  run -0 uv run --with pyte python - "$BATS_FILE_TMPDIR/cache.snap" $size <<'PYTE'
import sys
import pyte

class Terminal(pyte.Screen):
    def report_device_status(self, mode, **kwargs):
        if not kwargs.get("private"):
            super().report_device_status(mode)


screen = Terminal(int(sys.argv[2]), int(sys.argv[3]))
pyte.Stream(screen).feed(open(sys.argv[1], "rb").read().decode("utf-8", "replace"))
for y, line in enumerate(screen.display):
    if "CACHEACACHEB" in line:
        x = line.index("CACHEACACHEB")
        for offset, expected in ((0, "8a8a8c"), (6, "626265")):
            cell = screen.buffer[y][x + offset]
            assert (cell.fg, cell.bg) == (expected, expected), (offset, cell)
        break
else:
    raise AssertionError("collision fixture missing from terminal screen")
PYTE
  tx set-window-option -u window-style
  reset_panes
  reap_client
  start_client
  assert_alive
}

@test "copy-mode: scroll a tiled pane with history" {
  reset_panes
  tx split-window -t SMOKE -- sh -c 'seq 1 500; exec sleep 300'
  p=$(tx display-message -p '#{pane_id}')
  # ast-grep-ignore: no-hard-wait - letting 500 lines land in the pane before entering copy-mode
  sleep 0.5
  tx copy-mode -t "$p"
  tx send-keys -t "$p" -X -N 10 scroll-up
  tx send-keys -t "$p" -X halfpage-up
  tx send-keys -t "$p" -X cancel
  tx kill-pane -t "$p"
  assert_alive
}

@test "copy-mode: scroll inside a float" {
  floats_supported || skip "no floating-pane support in this tmux"
  reset_panes
  tx new-pane -- sh -c 'seq 1 500; exec sleep 300'
  fp=$(tx display-message -p '#{pane_id}')
  [ "$(tx display-message -p -t "$fp" '#{pane_floating_flag}')" = 1 ]
  # ast-grep-ignore: no-hard-wait - letting 500 lines land in the float before entering copy-mode
  sleep 0.5
  tx copy-mode -t "$fp"
  tx send-keys -t "$fp" -X -N 10 scroll-up
  tx send-keys -t "$fp" -X cancel
  tx kill-pane -t "$fp"
  assert_alive
}

@test "display-panes overlay shows and auto-dismisses" {
  reset_panes
  tx split-window -t SMOKE -- sh -c 'exec sleep 300'
  tx display-panes -d 200
  # ast-grep-ignore: no-hard-wait - display-panes' own -d 200 overlay has no completion event
  sleep 0.5
  reset_panes
  assert_alive
}

@test "popup renders and closes" {
  reset_panes
  tx display-popup -E true
  # ast-grep-ignore: no-hard-wait - the popup's draw and teardown have no completion event
  sleep 0.5
  assert_alive
}

@test "split and resize in all four directions" {
  reset_panes
  tx split-window -h -t SMOKE -- sh -c 'exec sleep 300'
  p=$(tx display-message -p '#{pane_id}')
  tx split-window -v -t "$p" -- sh -c 'exec sleep 300'
  for dir in -L -R -U -D; do
    tx resize-pane -t "$p" "$dir" 3
    sleep 0.1
  done
  reset_panes
  assert_alive
}

# refresh-client -C is control-client-only on tmux 3.7, so drive the same
# split-status offset math by resizing the window under the live client
# instead (this flips window-size to manual; unset + -A restores latest).
@test "window resize under the client exercises split-status offsets" {
  reset_panes
  cw=$(tx display-message -p '#{client_width}')
  ch=$(tx display-message -p '#{client_height}')
  tx resize-window -t SMOKE -x $((cw + 20)) -y $((ch + 6))
  # ast-grep-ignore: no-hard-wait - letting the resize repaint before the next one
  sleep 0.3
  tx resize-window -t SMOKE -x $((cw - 20)) -y $((ch - 6))
  # ast-grep-ignore: no-hard-wait - letting the resize repaint before the next one
  sleep 0.3
  tx set-option -wu -t SMOKE window-size
  tx resize-window -t SMOKE -A
  # ast-grep-ignore: no-hard-wait - letting -A repaint before reading the restored width
  sleep 0.3
  [ "$(tx display-message -p '#{window_width}')" = "$cw" ]
  assert_alive
}

# command-prompt issued from an outside command client BLOCKS until the prompt
# is answered, so it must be backgrounded and reaped; the rendered prompt then
# outlives its issuing client, so the pty client is bounced to clear the
# overlay for later tests.
@test "message and command-prompt render on the split status rows" {
  reset_panes
  tx display-message 'render smoke message row'
  # Both waits poll the client's own log for the text that must appear on the
  # status row. Blind sleeps here made the test pass whether or not anything
  # rendered - a silent coverage hole in the one file whose entire purpose is
  # driving the real config through the redraw path.
  wait_until -i 0.1 -d 'tail -c 400 "$LOG"' 'grep -q "render smoke message row" "$LOG"'
  "$TMUX_BIN" -L "$SOCK" command-prompt -p 'MARKERPROMPT:' </dev/null >/dev/null 2>&1 &
  cp_pid=$!
  wait_until -i 0.1 -d 'tail -c 400 "$LOG"' 'grep -q MARKERPROMPT "$LOG"'
  assert_alive
  kill "$cp_pid" 2>/dev/null || true
  reap_client
  start_client
  assert_alive
}

@test "pane-scrollbars on: copy-mode scroll and cancel" {
  reset_panes
  tx set-option -g pane-scrollbars on
  tx split-window -t SMOKE -- sh -c 'seq 1 500; exec sleep 300'
  p=$(tx display-message -p '#{pane_id}')
  # ast-grep-ignore: no-hard-wait - letting 500 lines land in the pane before entering copy-mode
  sleep 0.5
  tx copy-mode -t "$p"
  tx send-keys -t "$p" -X -N 10 scroll-up
  tx send-keys -t "$p" -X cancel
  tx set-option -gu pane-scrollbars
  tx kill-pane -t "$p"
  assert_alive
}

# The historically implicated combination (a live 'modal' trial once coincided
# with losing a server on this patched build) - deliberately near-last.
@test "pane-scrollbars modal: copy-mode scroll and cancel" {
  reset_panes
  tx set-option -g pane-scrollbars modal
  tx split-window -t SMOKE -- sh -c 'seq 1 500; exec sleep 300'
  p=$(tx display-message -p '#{pane_id}')
  # ast-grep-ignore: no-hard-wait - letting 500 lines land in the pane before entering copy-mode
  sleep 0.5
  tx copy-mode -t "$p"
  tx send-keys -t "$p" -X -N 20 scroll-up
  tx send-keys -t "$p" -X halfpage-down
  tx send-keys -t "$p" -X cancel
  tx set-option -gu pane-scrollbars
  tx kill-pane -t "$p"
  assert_alive
}

@test "churn: floats created, resized and killed over heavy output" {
  floats_supported || skip "no floating-pane support in this tmux"
  reset_panes
  tx split-window -t SMOKE -- sh -c 'while :; do seq 1 200; done'
  noisy=$(tx display-message -p '#{pane_id}')
  for i in $(seq 1 15); do
    tx new-pane -- sh -c 'exec sleep 60'
    fp=$(tx display-message -p '#{pane_id}')
    tx resize-pane -t "$fp" -x 60 -y 12 2>/dev/null || true
    tx kill-pane -t "$fp"
  done
  tx kill-pane -t "$noisy"
  assert_alive
}

@test "pyte: composited screen shows status rows, border, and float on top" {
  command -v uv >/dev/null 2>&1 || skip "uv unavailable"
  floats_supported || skip "no floating-pane support in this tmux"
  reset_panes
  tx split-window -t SMOKE -- sh -c 'printf MARKERTILE; exec sleep 300'
  # Explicit geometry: floats remember their last per-window size/position, and
  # the churn test's resizes would otherwise leave this one mostly off-screen
  # (upstream 3.7 behaviour, reproducible with -f /dev/null - not the patches).
  tx new-pane -x 40 -y 8 -X 4 -Y 4 -- sh -c 'printf MARKERFLOAT; exec sleep 300'
  # Fresh client on a fresh log: the shared log is megabytes of churn by now.
  reap_client
  pyte_log="$BATS_FILE_TMPDIR/pyte.log"
  start_client "$pyte_log"
  # The float and the status row have reached the client, so it has received the
  # composite it is about to be asked about. 1.5s of sleep was a guess at that,
  # and under `-j` the four content assertions below could all have been reading
  # a half-drawn screen. Not MARKERTILE: the float covers the tiled pane, so
  # those cells are never sent - which is itself what the last assertion checks.
  #
  # -t 60, not the 10s default: this is the one test that waits on a fresh pty
  # client's first full paint of the real config, behind two pane spawns, and in
  # the full 1476-test suite it timed out at 10s with the log at 14KB and still
  # filling. A backstop costs a passing run nothing; the poll returns as soon as
  # the composite is there.
  wait_until -t 60 -i 0.1 -d 'wc -c <"$pyte_log"' \
    'grep -q MARKERFLOAT "$pyte_log" && grep -q SMOKE "$pyte_log"'
  local before
  before=$(wc -c <"$pyte_log")
  tx refresh-client
  # refresh-client repaints the whole screen: the log growing past the mark is
  # the client having received that repaint.
  wait_until -t 60 -i 0.1 -d 'wc -c <"$pyte_log"' '[ "$(wc -c <"$pyte_log")" -gt "$before" ]'
  size=$(tx display-message -p '#{client_width}x#{client_height}')
  # Snapshot while attached: detach teardown wipes the composited screen.
  cp "$pyte_log" "$BATS_FILE_TMPDIR/pyte.snap"
  run -0 uv run --with pyte "$HOME/.config/tmux/scripts/render-dump.py" \
    "$BATS_FILE_TMPDIR/pyte.snap" "$size"
  # Top status row: session name from status-left #S.
  printf '%s\n' "$output" | head -n1 | grep -q 'SMOKE'
  # Bottom status row: status-right clock.
  printf '%s\n' "$output" | tail -n1 | grep -Eq '[0-9][0-9]:[0-9][0-9]'
  # A pane border glyph (the config draws heavy lines) and the float
  # composited on top of the tiled panes.
  printf '%s\n' "$output" | grep -q -e '─' -e '│' -e '━' -e '┃'
  printf '%s\n' "$output" | grep -q 'MARKERFLOAT'
  reset_panes
  assert_alive
}
