#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-state.sh"

# All assertions run against a throwaway private tmux server (real infrastructure,
# not a stub) so the window rollup is computed by tmux exactly as in production.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentstate_${BATS_TEST_NUMBER}_$$"
  # -f /dev/null: bare server, no real tmux.conf. The script reads only the
  # @agent_state it manages itself, so the config adds nothing the test checks
  # while its focus hooks (see ../../tmux/tmux.conf) would fire agent-state.sh
  # mid-test and mutate state under us. Bare is faster and better isolated.
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
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
large_hook_payload() {
  awk 'BEGIN { for (i = 0; i < 5000; i++) print "{\"tool\":\"PostToolUse\",\"payload\":\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"}" }'
}

@test "working sets the pane state and rolls up to the window" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$pane" working
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
  [ "$(wstate "$win")" = working ]
}

@test "large ignored hook stdin is drained before setting working" {
  pane=$(tx display-message -p -t s '#{pane_id}')

  run bash -o pipefail -c "$(declare -f large_hook_payload); large_hook_payload | env AGENT_STATE_PANE=\"\$1\" sh \"\$2\" working codex" bash "$pane" "$SCRIPT"

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  [ "$(pstate "$pane")" = working ]
}

@test "large ignored hook stdin is drained before no-pane no-op" {
  run bash -o pipefail -c "$(declare -f large_hook_payload); large_hook_payload | env -u AGENT_STATE_PANE -u TMUX_PANE sh \"\$1\" working codex" bash "$SCRIPT"

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
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

# The bare test server is detached (new-session -d), so session_attached==0 —
# nobody is looking. Seen-at-birth (is_viewing) therefore keeps `done` blue even
# on the active window/pane: an active window alone is not "you are viewing it".
# The viewed(attached) done -> idle path is covered by agent-sweep.bats, which
# attaches a real client and exercises the same shared is_viewing gate.
@test "done in the active window of a detached session stays done (nobody attached)" {
  pane=$(tx display-message -p -t s '#{pane_id}') # sole window/pane active, but detached
  ason "$pane" done
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = done ]
}

@test "unread forces done in the active window (manual inverse of seen)" {
  pane=$(tx display-message -p -t s '#{pane_id}') # sole window is active
  win=$(tx display-message -p -t s '#{window_id}')
  ason "$pane" unread
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = done ] # done, NOT collapsed to idle like the `done` verb
  [ "$(wstate "$win")" = done ]
}

@test "unread then seen round-trips done -> idle (mark unread, then read)" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" unread
  [ "$(pstate "$pane")" = done ]
  ason "$pane" seen
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

# --- name/unname: @agent_name label riding @agent_state's lifecycle ---

@test "name sets @agent_name on a state-carrying pane" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working
  ason "$pane" name backend
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$pane" @agent_name)" = backend ]
}

@test "name is rejected on a stateless pane" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" name backend
  [ "$status" -eq 2 ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_name)" ]
}

@test "name rejects invalid labels" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working
  for bad in Backend 9x -x 'has space' 'foo!' "$(printf 'a%.0s' $(seq 33))"; do
    ason "$pane" name "$bad"
    [ "$status" -eq 2 ]
  done
  [ -z "$(tx show-options -pqv -t "$pane" @agent_name)" ]
}

@test "name leaves @agent_state and @agent_kind untouched" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working claude
  ason "$pane" name backend
  [ "$(pstate "$pane")" = working ]
  [ "$(tx show-options -pqv -t "$pane" @agent_kind)" = claude ]
  [ "$(tx show-options -pqv -t "$pane" @agent_name)" = backend ]
}

@test "unname removes @agent_name" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working
  ason "$pane" name backend
  ason "$pane" unname
  [ "$status" -eq 0 ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_name)" ]
}

@test "clear also drops @agent_name" {
  pane=$(tx display-message -p -t s '#{pane_id}')
  ason "$pane" working
  ason "$pane" name backend
  ason "$pane" clear
  [ "$status" -eq 0 ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_name)" ]
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

# --- stop_state: in-flight-count -> verb (pure) ---

@test "stop_state: 0 in-flight -> done" {
  . "$LIB"
  [ "$(stop_state 0)" = done ]
}

@test "stop_state: positive count -> working" {
  . "$LIB"
  [ "$(stop_state 3)" = working ]
}

@test "stop_state: empty -> done" {
  . "$LIB"
  [ "$(stop_state "")" = done ]
}

@test "stop_state: non-numeric -> done" {
  . "$LIB"
  [ "$(stop_state null)" = done ]
}

# --- valid_agent_name: label grammar (pure) ---

@test "valid_agent_name accepts conforming labels" {
  . "$LIB"
  for good in backend a web-1 x_y "$(printf 'a%.0s' $(seq 32))"; do
    valid_agent_name "$good"
  done
}

@test "valid_agent_name rejects malformed labels" {
  . "$LIB"
  for bad in '' Backend 1x -x 'has space' 'foo!' "$(printf 'a%.0s' $(seq 33))"; do
    ! valid_agent_name "$bad"
  done
}

# --- agent_name_taken: live-name collision check (real server) ---

@test "agent_name_taken sees another pane's name but excludes self" {
  . "$LIB"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_name backend
  agent_name_taken backend
  ! agent_name_taken backend "$p1"
  ! agent_name_taken other
}

# --- is_viewing: "you are looking at the pane" (pure predicate) ---

@test "is_viewing: active pane, active window, attached -> viewed" {
  . "$LIB"
  is_viewing 1 1 1
}

@test "is_viewing: multiple attached clients still viewed" {
  . "$LIB"
  is_viewing 1 1 2
}

@test "is_viewing: detached session (0 clients) is not viewed" {
  . "$LIB"
  ! is_viewing 1 1 0
}

@test "is_viewing: inactive window is not viewed" {
  . "$LIB"
  ! is_viewing 1 0 1
}

@test "is_viewing: inactive pane is not viewed" {
  . "$LIB"
  ! is_viewing 0 1 1
}

@test "is_viewing: missing fields default to not viewed" {
  . "$LIB"
  ! is_viewing
}

# --- agent-stop.sh adapter: Stop payload on stdin -> pane state ---
#
# Counts only finite work (workflow|subagent): pending work keeps the dot
# peach (working), a drained/empty array goes blue (done), and persistent
# watchers (monitor|dream) plus background shells (often never-exiting dev
# servers) must not pin it at working. The done-expecting cases
# add a second window (finish on a background window) so the pane is unambiguously
# unseen; the detached bare server would keep it `done` regardless (seen-at-birth
# needs an attached client), but the extra window keeps intent explicit.
# jq-parse cases skip without jq.

STOP="$TESTS_DIR/../../tmux/scripts/agent-stop.sh"

# astop PANE JSON — feed JSON to agent-stop.sh on stdin against the private server.
astop() { run env AGENT_STATE_PANE="$1" sh "$STOP" <<<"$2"; }

@test "agent-stop: pending workflow keeps working" {
  command -v jq >/dev/null || skip "jq not installed"
  pane=$(tx display-message -p -t s '#{pane_id}')
  astop "$pane" '{"background_tasks":[{"id":"1","type":"workflow","status":"running","description":"d"}]}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
}

@test "agent-stop: pending subagent keeps working" {
  command -v jq >/dev/null || skip "jq not installed"
  pane=$(tx display-message -p -t s '#{pane_id}')
  astop "$pane" '{"background_tasks":[{"id":"1","type":"subagent","status":"pending","description":"d"}]}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$pane")" = working ]
}

@test "agent-stop: empty background_tasks -> done" {
  command -v jq >/dev/null || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}') # window 1, currently active
  tx new-window -t s                            # window 2 active; window 1 inactive
  astop "$p1" '{"background_tasks":[]}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "agent-stop: lone background shell -> done (server must not pin working)" {
  command -v jq >/dev/null || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s
  astop "$p1" '{"background_tasks":[{"id":"1","type":"shell","status":"running","description":"pnpm serve"}]}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "agent-stop: lone monitor -> done (must not pin working)" {
  command -v jq >/dev/null || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s
  astop "$p1" '{"background_tasks":[{"id":"1","type":"monitor","status":"running","description":"d"}]}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "agent-stop: missing background_tasks -> done" {
  command -v jq >/dev/null || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s
  astop "$p1" '{}'
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
}

@test "agent-stop: malformed JSON degrades to done" {
  command -v jq >/dev/null || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s
  astop "$p1" 'not json'
  [ "$status" -eq 0 ]
  [ "$(pstate "$p1")" = done ]
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
