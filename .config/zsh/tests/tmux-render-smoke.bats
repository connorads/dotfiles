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
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || {
    export SMOKE_SKIP="tmux not installed"
    return 0
  }
  command -v script >/dev/null 2>&1 || {
    export SMOKE_SKIP="script (pty) unavailable"
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
    tx kill-server 2>/dev/null || true
    export SMOKE_SKIP="could not attach a pty client in this environment"
  fi
}

teardown_file() {
  reap_client
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

setup() {
  [ -z "${SMOKE_SKIP:-}" ] || skip "$SMOKE_SKIP"
  ensure_alive
}

# The session's base pane runs sleep, never a shell: `script` forwards its
# stdin EOF into the pty as ^D, and a shell reading that ^D exits and takes a
# one-pane session (and the server) with it - the exact failure mode this file
# guards against would then be self-inflicted. sleep ignores stdin.
start_server() {
  AGENT_JOURNAL_DISABLE=1 "$TMUX_BIN" -L "$SOCK" -f "$HOME/.config/tmux/tmux.conf" \
    new-session -d -s SMOKE -x 80 -y 24 -- sh -c 'exec sleep 2147483647'
}

# (Re)attach a pty client recording to ${1:-$LOG}. Pids go to
# $BATS_FILE_TMPDIR/*.pid, not variables: a mid-file revive would leave
# exported pid vars stale in later tests, but the pidfiles always name the
# current client/holder. `script` needs immediate flush (-F BSD / -f
# util-linux) or the log stays empty until the client exits - and a clean
# detach then wipes the composited screen with the alternate-screen teardown,
# so anything reading $LOG must snapshot it while the client is still attached.
start_client() {
  local log="${1:-$LOG}"
  : >"$log"
  if script --help 2>&1 | grep -q 'illegal option'; then # BSD
    TERM=${TERM:-xterm-256color} script -qF "$log" "$TMUX_BIN" -L "$SOCK" attach -t SMOKE \
      </dev/null >/dev/null 2>&1 3>&- &
  else # util-linux
    TERM=${TERM:-xterm-256color} script -qfc "$TMUX_BIN -L $SOCK attach -t SMOKE" "$log" \
      </dev/null >/dev/null 2>&1 3>&- &
  fi
  echo $! >"$BATS_FILE_TMPDIR/client.pid"
  wait_for_client || return 1
  # Proven risk: the client must persist past its stdin EOF. If this tmux/script
  # combination drops the client on EOF, hold the pty open from a FIFO instead.
  sleep 1
  [ -n "$(tx list-clients 2>/dev/null)" ] && return 0
  reap_client
  local fifo="$BATS_FILE_TMPDIR/stdin.fifo"
  rm -f "$fifo"
  mkfifo "$fifo"
  tail -f /dev/null >"$fifo" &
  echo $! >"$BATS_FILE_TMPDIR/holder.pid"
  if script --help 2>&1 | grep -q 'illegal option'; then
    TERM=${TERM:-xterm-256color} script -qF "$log" "$TMUX_BIN" -L "$SOCK" attach -t SMOKE \
      <"$fifo" >/dev/null 2>&1 3>&- &
  else
    TERM=${TERM:-xterm-256color} script -qfc "$TMUX_BIN -L $SOCK attach -t SMOKE" "$log" \
      <"$fifo" >/dev/null 2>&1 3>&- &
  fi
  echo $! >"$BATS_FILE_TMPDIR/client.pid"
  wait_for_client
}

wait_for_client() {
  local i
  for i in $(seq 1 50); do
    [ -n "$(tx list-clients -F '#{client_name}' 2>/dev/null)" ] && return 0
    sleep 0.2
  done
  return 1
}

reap_client() {
  local f
  for f in "$BATS_FILE_TMPDIR/client.pid" "$BATS_FILE_TMPDIR/holder.pid"; do
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

@test "copy-mode: scroll a tiled pane with history" {
  reset_panes
  tx split-window -t SMOKE -- sh -c 'seq 1 500; exec sleep 300'
  p=$(tx display-message -p '#{pane_id}')
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
  sleep 0.5
  reset_panes
  assert_alive
}

@test "popup renders and closes" {
  reset_panes
  tx display-popup -E true
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
  sleep 0.3
  tx resize-window -t SMOKE -x $((cw - 20)) -y $((ch - 6))
  sleep 0.3
  tx set-option -wu -t SMOKE window-size
  tx resize-window -t SMOKE -A
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
  sleep 0.3
  "$TMUX_BIN" -L "$SOCK" command-prompt </dev/null >/dev/null 2>&1 &
  cp_pid=$!
  sleep 0.5
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
  sleep 1
  tx refresh-client
  sleep 0.5
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
