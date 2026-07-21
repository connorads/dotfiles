#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-sweep.sh"
SHELLS=" zsh bash sh fish dash ash "

# All assertions run against a throwaway private tmux server (real infrastructure)
# so the sweep's list-panes read and rollup are computed by tmux exactly as in
# production. Bare `tmux` (as the script invokes it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentsweep_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: bare server (see AGENTS.md). The sweep reads only @agent_state,
  # which the script manages itself; the real config adds nothing and its focus
  # hooks would contaminate the test. Bare is faster and better isolated.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  # Kill the daemon by tracked PID (covers no-setsid) and by pidfile (covers a
  # setsid fork on Linux giving the real daemon a different PID) before the server.
  if [ -n "${DAEMON_PID:-}" ]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    kill -- -"$DAEMON_PID" 2>/dev/null || true
  fi
  for f in "$BATS_TEST_TMPDIR"/server-*.pid; do
    [ -f "$f" ] || continue
    p=$(cat "$f" 2>/dev/null || true)
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
  [ -n "${ATTACH_PID:-}" ] && kill "$ATTACH_PID" 2>/dev/null || true
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# attach_client — attach a real client to session s through a pty so
# session_attached becomes >0 (the sweep's "someone is viewing" gate). `script`
# differs across BSD (macOS) and util-linux, so try both forms. Backgrounded;
# ATTACH_PID is killed in teardown. Returns non-zero if the pty never attaches so
# callers can `skip` (some CI environments refuse to allocate one).
attach_client() {
  if script --version >/dev/null 2>&1; then
    script -qec "$TMUX_BIN -L $SOCK attach -t s" /dev/null >/dev/null 2>&1 &
  else
    script -q /dev/null "$TMUX_BIN" -L "$SOCK" attach -t s >/dev/null 2>&1 &
  fi
  ATTACH_PID=$!
  local i
  for i in $(seq 1 25); do
    [ "$(tx display-message -p -t s '#{session_attached}')" != 0 ] && return 0
    sleep 0.2
  done
  return 1
}

# Launch the daemon backgrounded with an isolated state dir + 1s poll. 3>&- closes
# bats's status fd so the loop does not keep the run hanging; fds 1/2 → /dev/null.
launch_daemon() {
  AGENT_SWEEP_STATE_DIR="$BATS_TEST_TMPDIR" AGENT_SWEEP_POLL=1 \
    sh "$SCRIPT" daemon >/dev/null 2>&1 3>&- &
  DAEMON_PID=$!
}

# Poll up to ~6s for a file to appear.
wait_file() {
  local i
  for i in $(seq 1 30); do
    [ -f "$1" ] && return 0
    sleep 0.2
  done
  return 1
}

pstate() { tx show-options -pqv -t "$1" @agent_state; }
wstate() { tx show-options -wqv -t "$1" @win_agent_state; }

# Wait until a pane's foreground command is no longer a bare shell — i.e. the
# respawned child has taken over. Returns non-zero on timeout (~6s) so callers
# can skip rather than assert a precondition the pane never reached (the sweep
# correctly clears shell-foreground dots, so asserting on one is wrong). Panes
# are respawned with a child that has no rc files, so the only non-shell that
# ever appears is that child — no interactive-startup transient can fool this.
wait_nonshell() {
  local pane=$1 cmd i
  for i in $(seq 1 30); do
    cmd=$(tx display-message -p -t "$pane" '#{pane_current_command}')
    case "$SHELLS" in *" $cmd "*) sleep 0.2 ;; *) return 0 ;; esac
  done
  return 1
}

@test "sweep clears a stale dot on a shell-foreground pane" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx set-option -p -t "$pane" @agent_state working
  tx set-option -p -t "$pane" @agent_kind claude
  tx set-option -p -t "$pane" @agent_name backend
  tx set-option -w -t "$win" @win_agent_state working
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$(pstate "$pane")" ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_kind)" ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_name)" ]
  [ -z "$(wstate "$win")" ]
}

@test "sweep leaves a non-shell foreground pane untouched" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx respawn-pane -k -t "$pane" 'sh -c "exec sleep 300"'
  wait_nonshell "$pane" || skip "pane shell did not yield the foreground in time"
  tx set-option -p -t "$pane" @agent_state working
  tx set-option -p -t "$pane" @agent_name backend
  tx set-option -w -t "$win" @win_agent_state working
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
  [ "$(tx show-options -pqv -t "$pane" @agent_name)" = backend ]
  [ "$(wstate "$win")" = working ]
}

@test "sweep recomputes the window dot down when the worst pane was hard-closed" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx respawn-pane -k -t "$p1" 'sh -c "exec sleep 300"'
  wait_nonshell "$p1" || skip "pane shell did not yield the foreground in time"
  tx split-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p2" @agent_state blocked
  tx set-option -w -t "$win" @win_agent_state blocked
  tx kill-pane -t "$p2" # worst pane gone; rollup now stale at blocked
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = working ]
  [ "$(wstate "$win")" = working ]
}

@test "sweep ages a done pane you are viewing to idle" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx respawn-pane -k -t "$pane" 'sh -c "exec sleep 300"' # alive, non-shell
  wait_nonshell "$pane" || skip "pane shell did not yield the foreground in time"
  attach_client || skip "could not attach a client for the viewing gate"
  tx set-option -p -t "$pane" @agent_state done
  tx set-option -w -t "$win" @win_agent_state done
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = idle ]
  [ "$(wstate "$win")" = idle ]
}

@test "sweep leaves a done pane in an inactive window unaged" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx respawn-pane -k -t "$p1" 'sh -c "exec sleep 300"'
  wait_nonshell "$p1" || skip "pane shell did not yield the foreground in time"
  attach_client || skip "could not attach a client for the viewing gate"
  tx new-window -t s # window 2 active; p1's window now inactive (not viewed)
  tx set-option -p -t "$p1" @agent_state done
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "sweep leaves a done pane unaged when no client is attached" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  tx respawn-pane -k -t "$pane" 'sh -c "exec sleep 300"'
  wait_nonshell "$pane" || skip "pane shell did not yield the foreground in time"
  # no attach_client: session_attached == 0, so nobody is looking
  tx set-option -p -t "$pane" @agent_state done
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = done ]
}

@test "sweep is a quiet no-op when nothing is stale" {
  win=$(tx display-message -p -t s '#{window_id}')
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$(wstate "$win")" ]
}

@test "sweep is a quiet no-op when the server is gone" {
  tx kill-server 2>/dev/null || true
  run sh "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "daemon starts one process with a pidfile and is idempotent" {
  pidfile="$BATS_TEST_TMPDIR/server-$(tx display-message -p '#{pid}').pid"
  launch_daemon
  wait_file "$pidfile"
  [ -f "$pidfile" ]
  first=$(cat "$pidfile")
  kill -0 "$first"
  # A second invocation finds the live daemon and no-ops without touching the pidfile.
  run env AGENT_SWEEP_STATE_DIR="$BATS_TEST_TMPDIR" AGENT_SWEEP_POLL=1 sh "$SCRIPT" daemon
  [ "$status" -eq 0 ]
  [ "$(cat "$pidfile")" = "$first" ]
}

@test "daemon clears a stale dot on its interval" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  pidfile="$BATS_TEST_TMPDIR/server-$(tx display-message -p '#{pid}').pid"
  launch_daemon
  wait_file "$pidfile"
  tx set-option -p -t "$pane" @agent_state working
  tx set-option -w -t "$win" @win_agent_state working
  cleared=0
  for i in $(seq 1 20); do
    [ -z "$(pstate "$pane")" ] && {
      cleared=1
      break
    }
    sleep 0.2
  done
  [ "$cleared" -eq 1 ]
  [ -z "$(wstate "$win")" ]
}

@test "daemon exits when the server dies" {
  pidfile="$BATS_TEST_TMPDIR/server-$(tx display-message -p '#{pid}').pid"
  launch_daemon
  wait_file "$pidfile"
  dpid=$(cat "$pidfile")
  tx kill-server 2>/dev/null || true
  gone=0
  for i in $(seq 1 30); do
    kill -0 "$dpid" 2>/dev/null || {
      gone=1
      break
    }
    sleep 0.2
  done
  [ "$gone" -eq 1 ]
}
