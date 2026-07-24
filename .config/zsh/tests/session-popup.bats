#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/session-popup.sh"

# All assertions run against a throwaway private tmux server (real infrastructure)
# so switch/create is exercised by tmux exactly as in production. Bare `tmux` (as
# the script invokes it) is pointed here via $TMUX. fzf `pick` is not unit-tested
# (needs a real TTY) — mirrors the agent-popup.sh split rationale.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="sessionpopup_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: bare server (see AGENTS.md). The script drives only
  # has-session/new-session/switch-client; the real config adds nothing and its
  # focus hooks would contaminate the test.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s main -x 80 -y 24
  TMUX="$(tx display-message -p -t main '#{socket_path}'),$(tx display-message -p -t main '#{pid}'),0"
  export TMUX
}

teardown() {
  [ -n "${ATTACH_PID:-}" ] && kill "$ATTACH_PID" 2>/dev/null || true
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# attach_client — attach a real client through a pty so switch-client has a
# client to move. `script` differs across BSD (macOS) and util-linux, so try both.
# Backgrounded; ATTACH_PID is killed in teardown. Returns non-zero if no pty
# attaches so callers can `skip`.
attach_client() {
  if script --version >/dev/null 2>&1; then
    script -qec "$TMUX_BIN -L $SOCK attach -t main" /dev/null >/dev/null 2>&1 &
  else
    script -q /dev/null "$TMUX_BIN" -L "$SOCK" attach -t main >/dev/null 2>&1 &
  fi
  ATTACH_PID=$!
  local i
  for i in $(seq 1 25); do
    [ "$(tx display-message -p -t main '#{session_attached}')" != 0 ] && return 0
    sleep 0.2
  done
  return 1
}

# client_session — the session the (single) attached client currently shows.
client_session() { tx list-clients -F '#{client_session}' | head -n1; }

@test "switch creates a new session when absent, then switches to it" {
  attach_client || skip "no pty available to attach a client"
  run env TMUX="$TMUX" sh "$SCRIPT" switch project
  [ "$status" -eq 0 ]
  tx has-session -t=project
  [ "$(client_session)" = project ]
}

@test "switch focuses an existing session without recreating it" {
  attach_client || skip "no pty available to attach a client"
  tx new-session -ds project
  win_before=$(tx list-windows -t project -F '#{window_id}')
  run env TMUX="$TMUX" sh "$SCRIPT" switch project
  [ "$status" -eq 0 ]
  [ "$(client_session)" = project ]
  # Same session object (new-session was not run again): its window is unchanged.
  [ "$(tx list-windows -t project -F '#{window_id}')" = "$win_before" ]
}

@test "switch with no name exits non-zero" {
  run env TMUX="$TMUX" sh "$SCRIPT" switch
  [ "$status" -eq 2 ]
}

@test "unknown subcommand exits non-zero" {
  run env TMUX="$TMUX" sh "$SCRIPT" bogus
  [ "$status" -eq 2 ]
}
