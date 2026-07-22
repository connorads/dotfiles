#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-popup.sh"

# A throwaway private tmux server started with `-f /dev/null` (no real config) so
# jump's explicit `seen` call is what ages done → idle, not the real config's
# focus hooks. Bare `tmux` (as the script invokes it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentpopup_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  # No sweep during pick (keeps list tests deterministic); resolve the seen helper
  # from the repo so jump can age done → idle.
  export AGENT_SWEEP=/nonexistent
  export AGENT_STATE_SH="$TESTS_DIR/../../tmux/scripts/agent-state.sh"
}

teardown() {
  # Plain kill hangs up the pty so `tmux attach` exits; kill-server then reaps the
  # private server. (No process-group kill: under bats the backgrounded client is
  # not a group leader, so it shares this shell's group — a -PGID kill is a no-op.)
  if [ -n "${CLIENT_BG:-}" ]; then kill "$CLIENT_BG" 2>/dev/null || true; fi
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# Attach a background client to session $1 over a pseudo-tty so switch-client has a
# real client to move. Dual `script` syntax (BSD vs util-linux) mirrors test_helper
# run_in_tty; TERM is forced because CI runners leave it unset/dumb and tmux's
# client then fails to open the terminal (which would silently skip this test).
# 3>&- closes bats's status fd so the attached client does not hang the run.
attach_client() {
  local sess=${1:-s}
  if script --help 2>&1 | grep -q 'illegal option'; then
    TERM=${TERM:-screen} script -q /dev/null "$TMUX_BIN" -L "$SOCK" attach -t "$sess" >/dev/null 2>&1 3>&- &
  else
    TERM=${TERM:-screen} script -qc "$TMUX_BIN -L $SOCK attach -t $sess" /dev/null >/dev/null 2>&1 3>&- &
  fi
  CLIENT_BG=$!
  local i
  for i in $(seq 1 30); do
    [ -n "$(tx list-clients -F '#{client_name}' 2>/dev/null)" ] && return 0
    sleep 0.2
  done
  return 1
}

@test "list ranks blocked > done > working > idle and hides pane_id in field 1" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state blocked
  tx new-window -t s
  p3=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p3" @agent_state idle
  tx new-window -t s
  p4=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p4" @agent_state done
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  order=$(printf '%s\n' "$output" | cut -f1 | tr '\n' ' ')
  [ "$order" = "$p2 $p4 $p1 $p3 " ]
}

@test "list excludes panes without agent state" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx split-window -t s # second pane, no agent state
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 1 ]
  [ "$(printf '%s\n' "$output" | cut -f1)" = "$p1" ]
}

@test "list emits the catppuccin truecolour glyph" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state blocked
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"38;2;243;139;168"* ]]
}

# Pins the @agent_name column position (field 5, after kind): pane_id stays the
# hidden field 1 jump key, and an unnamed pane renders an empty column rather
# than shifting later fields.
@test "list surfaces @agent_name in field 5 and keeps pane_id in field 1" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_name backend
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | cut -f1)" = "$p1" ]
  [ "$(printf '%s\n' "$output" | cut -f5)" = backend ]
}

@test "list renders an empty name column without shifting fields" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  run sh "$SCRIPT" list
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | cut -f1)" = "$p1" ]
  [ -z "$(printf '%s\n' "$output" | cut -f5)" ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' '{ print NF }')" = 8 ]
}

@test "pick with no agents prints a notice and exits 0" {
  run sh "$SCRIPT" pick
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active agents"* ]]
}

@test "jump moves the active pane, tolerating a headless no-client" {
  tx split-window -t s
  set -- $(tx list-panes -t s -F '#{pane_id}')
  p1=$1
  p2=$2
  tx select-pane -t "$p1"
  [ "$(tx display-message -p -t s '#{pane_id}')" = "$p1" ]
  run sh "$SCRIPT" jump "$p2"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p -t s '#{pane_id}')" = "$p2" ]
}

@test "jump ages a done pane to idle and updates the window dot" {
  tx new-window -t s # window 2 active; window 1 inactive
  win1=$(tx list-windows -t s -F '#{window_id}' | head -n1)
  p1=$(tx list-panes -t "$win1" -F '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state done
  tx set-option -w -t "$win1" @win_agent_state done
  run sh "$SCRIPT" jump "$p1"
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = idle ]
  [ "$(tx show-options -wqv -t "$win1" @win_agent_state)" = idle ]
}

@test "jump with no pane id exits 2" {
  run sh "$SCRIPT" jump
  [ "$status" -eq 2 ]
}

# --- cycle: positional next-blocked jump (headless, like the jump tests) ---

# _next_pane is pure (rows on stdin, no tmux): extract just the function (the
# script's trailing dispatch would run on a full source) and exercise it.
next_pane() {
  sed -n '/^_next_pane()/,/^}/p' "$SCRIPT" >"$BATS_TEST_TMPDIR/next_pane.sh"
  sh -c ". \"$BATS_TEST_TMPDIR/next_pane.sh\"; _next_pane \"\$1\" \"\$2\"" _ "$@"
}

@test "_next_pane picks the first match strictly after the current pane, wrapping" {
  rows=$'%1\tblocked\n%2\tworking\n%3\tblocked'
  [ "$(printf '%s\n' "$rows" | next_pane blocked %1)" = %3 ]
  [ "$(printf '%s\n' "$rows" | next_pane blocked %3)" = %1 ] # wraps
  [ "$(printf '%s\n' "$rows" | next_pane blocked '')" = %1 ] # no current → top
  [ "$(printf '%s\n' "$rows" | next_pane blocked %9)" = %1 ] # unknown current → top
  [ -z "$(printf '%s\n' "$rows" | next_pane idle %1)" ]      # no match → empty
}

@test "cycle blocked moves the active pane to the next blocked pane" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state blocked
  tx new-window -t s
  p3=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p3" @agent_state blocked
  tx select-window -t "$p1"
  run sh "$SCRIPT" cycle blocked "$p1"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p '#{pane_id}')" = "$p2" ]
}

@test "cycle blocked wraps past the end back to an earlier blocked pane" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state blocked
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state working
  # current = p2 (after the only blocked pane) → wraps back to p1
  run sh "$SCRIPT" cycle blocked "$p2"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p '#{pane_id}')" = "$p1" ]
}

@test "cycle blocked,done falls back to done and ages it to idle" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s # p1's window inactive so the done dot is unseen
  win1=$(tx list-windows -t s -F '#{window_id}' | head -n1)
  tx set-option -p -t "$p1" @agent_state done
  tx set-option -w -t "$win1" @win_agent_state done
  p2=$(tx display-message -p -t s '#{pane_id}')
  run sh "$SCRIPT" cycle blocked,done "$p2"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p '#{pane_id}')" = "$p1" ]
  # jump()'s seen call ages the visited done pane, exactly as the popup does.
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = idle ]
  [ "$(tx show-options -wqv -t "$win1" @win_agent_state)" = idle ]
}

@test "cycle blocked alone does not fall back to done (message path)" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx new-window -t s
  win1=$(tx list-windows -t s -F '#{window_id}' | head -n1)
  tx set-option -p -t "$p1" @agent_state done
  tx set-option -w -t "$win1" @win_agent_state done
  p2=$(tx display-message -p -t s '#{pane_id}')
  run sh "$SCRIPT" cycle blocked "$p2"
  [ "$status" -eq 0 ]
  # No jump: the active pane stays put and the done dot is untouched (unaged).
  [ "$(tx display-message -p '#{pane_id}')" = "$p2" ]
  [ "$(tx show-options -pqv -t "$p1" @agent_state)" = done ]
}

@test "cycle with no agents is a quiet no-op" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  run sh "$SCRIPT" cycle blocked "$p1"
  [ "$status" -eq 0 ]
  [ "$(tx display-message -p '#{pane_id}')" = "$p1" ]
}

# Headed coverage of the one behaviour the headless tests cannot reach: jump's
# switch-client moving an *attached* client. The client is parked on a SECOND
# session so only switch-client (not select-window/select-pane, which the headless
# tests cover) can bring it to the target — isolating the cross-session move.
@test "jump switch-clients an attached client across sessions and ages done to idle" {
  command -v script >/dev/null 2>&1 || skip "script (pty) unavailable"
  w0=$(tx list-windows -t s -F '#{window_id}')
  p0=$(tx list-panes -t "$w0" -F '#{pane_id}') # target lives in session s
  tx new-session -d -s t -x 80 -y 24           # a SECOND session for the client
  attach_client t || skip "could not attach a pty client in this environment"
  cl=$(tx list-clients -F '#{client_name}' | head -n1)
  [ "$(tx display -p -c "$cl" '#{client_session}')" = t ] # precondition: parked on t
  tx set-option -p -t "$p0" @agent_state done
  tx set-option -w -t "$w0" @win_agent_state done
  run sh "$SCRIPT" jump "$p0"
  [ "$status" -eq 0 ]
  # A client that started on t now showing s/w0/p0 proves switch-client ran:
  # only switch-client can move a client across sessions. The client's
  # window/pane formats update asynchronously after switch-client (observed on
  # tmux 3.7b: ~1-2s behind while #{client_session} is already current), so
  # poll for the move instead of asserting the instant state.
  for i in $(seq 1 25); do
    [ "$(tx display -p -c "$cl" '#{pane_id}')" = "$p0" ] && break
    sleep 0.2
  done
  [ "$(tx display -p -c "$cl" '#{client_session}')" = s ]
  [ "$(tx display -p -c "$cl" '#{window_id}')" = "$w0" ]
  [ "$(tx display -p -c "$cl" '#{pane_id}')" = "$p0" ]
  # done → idle is aged only by jump's explicit seen call: the server runs with
  # -f /dev/null, so no focus hook can age it instead. Window dot recomputed too.
  [ "$(tx show-options -pqv -t "$p0" @agent_state)" = idle ]
  [ "$(tx show-options -wqv -t "$w0" @win_agent_state)" = idle ]
}
