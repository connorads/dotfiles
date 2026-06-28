#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-state.sh"

# All assertions run against a throwaway private tmux server (real infrastructure,
# not a stub) so the window rollup is computed by tmux exactly as in production.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentstate_${BATS_TEST_NUMBER}_$$"
  tx new-session -d -s s -x 80 -y 24
  # Point bare `tmux` (as the script invokes it) at this private server, exactly
  # as an agent's hook would via the $TMUX it inherits from its pane.
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# ason PANE STATE [KIND] — run agent-state.sh against a pane on the private server.
ason() { run env AGENT_STATE_PANE="$1" sh "$SCRIPT" "$2" "${3:-}"; }

pstate() { tx show-options -pqv -t "$1" @agent_state; }
wstate() { tx show-options -wqv -t "$1" @win_agent_state; }

@test "working sets the pane state and rolls up to the window" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$pane" working
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
  [ "$(wstate "$win")" = working ]
}

@test "agent kind is recorded when supplied" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working claude
  [ "$(tx show-options -pqv -t "$pane" @agent_kind)" = claude ]
}

@test "blocked outranks working in the window rollup" {
  tx split-window -t s
  set -- $(tx list-panes -t s -F '#{pane_id}')
  p1=$1
  p2=$2
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$p1" working
  [ "$status" -eq 0 ]
  ason "$p2" blocked
  [ "$status" -eq 0 ]
  [ "$(wstate "$win")" = blocked ]
}

@test "done in an inactive window stays done" {
  p1=$(tx display-message -p -t s '#{pane_id}') # window 1, currently active
  tx new-window -t s                            # window 2 active; window 1 inactive
  ason "$p1" done
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "done in the active window becomes idle (already seen)" {
  pane=$(tx display-message -p -t s '#{pane_id}') # sole window is active
  ason "$pane" done
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = idle ]
}

@test "seen ages a done pane to idle" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$pane" @agent_state done
  ason "$pane" seen
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = idle ]
}

@test "seen leaves a working pane untouched" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$pane" @agent_state working
  ason "$pane" seen
  [ "$(pstate "$pane")" = working ]
}

@test "clear removes the pane state and the window dot" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$pane" working
  [ "$(wstate "$win")" = working ]
  ason "$pane" clear
  [ "$status" -eq 0 ]
  [ -z "$(pstate "$pane")" ]
  [ -z "$(wstate "$win")" ]
}

@test "quiet no-op outside tmux" {
  run env -u TMUX -u TMUX_PANE AGENT_STATE_PANE= sh "$SCRIPT" working
  [ "$status" -eq 0 ]
}

@test "unknown state exits non-zero" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" bogus
  [ "$status" -eq 2 ]
}

# --- should_ring: fresh entry into blocked rings; re-emits don't ---

LIB="$TESTS_DIR/../../tmux/scripts/agent-state-lib.sh"

@test "should_ring: working->blocked rings" {
  . "$LIB"
  should_ring working
  [ "$?" -eq 0 ]
}

@test "should_ring: idle->blocked rings" {
  . "$LIB"
  should_ring idle
  [ "$?" -eq 0 ]
}

@test "should_ring: done->blocked rings" {
  . "$LIB"
  should_ring done
  [ "$?" -eq 0 ]
}

@test "should_ring: unset->blocked rings" {
  . "$LIB"
  should_ring ""
  [ "$?" -eq 0 ]
}

@test "should_ring: blocked->blocked does not ring" {
  . "$LIB"
  ! should_ring blocked
}

# --- blocked integration (real tmux server, no client attached) ---

@test "blocked sets pane and window state without crashing (no client)" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$pane" blocked
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = blocked ]
  [ "$(wstate "$win")" = blocked ]
}

@test "re-blocked is idempotent: state stays blocked, no crash" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" blocked
  [ "$status" -eq 0 ]
  ason "$pane" blocked
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = blocked ]
}
