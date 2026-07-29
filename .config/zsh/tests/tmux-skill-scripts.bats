#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

SKILL_DIR="$(cd "$BATS_TEST_DIRNAME/../../skills/personal/tmux" && pwd)"
WAIT_FOR_TEXT="$SKILL_DIR/scripts/wait-for-text.sh"
CONTROL_TAIL="$SKILL_DIR/scripts/control-tail.py"
FIND_SESSIONS="$SKILL_DIR/scripts/find-sessions.sh"

REAL_TMUX="${TMUX_BIN:-}"
if [[ -z "$REAL_TMUX" ]]; then
  REAL_TMUX="$(command -v tmux || true)"
fi

REAL_PYTHON3="$(command -v python3 || true)"

setup() {
  setup_test_home

  [[ -n "$REAL_TMUX" ]] || skip "tmux not found"
  [[ -n "$REAL_PYTHON3" ]] || skip "python3 not found"

  export TMUX_BIN="$REAL_TMUX"
  export PATH="$(dirname "$REAL_TMUX"):$(dirname "$REAL_PYTHON3"):$PATH"
  SOCK="tmux_skill_${BATS_TEST_NUMBER}_$$"
}

teardown() {
  if [[ -n ${SOCK:-} && -n ${TMUX_BIN:-} ]]; then
    "$TMUX_BIN" -L "$SOCK" kill-server >/dev/null 2>&1 || true
  fi
}

tx() {
  "$TMUX_BIN" -L "$SOCK" "$@"
}

# A fixed prompt, so "this shell is ready for keys" is something a test can see.
# send-keys before that is delivered to the pty but can be swallowed while bash
# is still setting the terminal up - and the test then waits out a whole deadline
# for output that was never going to be produced.
PANE_PROMPT='rdy% '

# BASH_SILENCE_DEPRECATION_WARNING: Apple's bash 3.2 otherwise greets every pane
# with a five-line zsh notice. Pure noise the control client must parse before
# reaching anything a test cares about, and it crowds the bounded tail buffer
# these tests assert on.
pane_shell() {
  printf '%s\n' -e BASH_SILENCE_DEPRECATION_WARNING=1 -e "PS1=$PANE_PROMPT" \
    /bin/bash --noprofile --norc
}

wait_for_prompt() {
  wait_until_visible "$1" "rdy%"
}

start_session() {
  local IFS=$'\n'
  # shellcheck disable=SC2046  # deliberate word split: pane_shell emits one arg per line
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 100 -y 24 $(pane_shell)
  wait_for_prompt s
}

wait_until_visible() {
  local target=$1
  local pattern=$2

  # -i 0.25, not the default: each poll forks a tmux client, and on a saturated
  # machine a tight loop here is competition for the very process being waited on.
  wait_until -i 0.25 -d 'tx capture-pane -pt "$target"' \
    'tx capture-pane -pt "$target" | grep -qE "$pattern"'
}

# A control-mode client only ever sees %output emitted AFTER it attached - tmux
# does not replay to a client that was not yet there. So a sentinel sent on a
# blind sleep is not merely late when startup overruns, it is missed forever,
# and the test then waits out the full timeout for an event that will never
# come. #{client_control_mode} is the observable that says the client is there.
wait_for_control_client() {
  wait_until -i 0.25 -d 'tx list-clients -F "#{client_name} #{client_control_mode}"' \
    'tx list-clients -F "#{client_control_mode}" 2>/dev/null | grep -qx 1'
}

# The three drivers below were `run bash -c '<multi-line script>'`. Lifted into
# functions so they are ordinary shell the linters and the $BASH5 contract can
# see - a quoted blob is invisible to both, and plain `bash` is Apple's 3.2.
#
# `run` turns errexit off, so what `set -euo pipefail` used to cover is now
# explicit `|| return 1` at each step.

run_wait_for_text_control() {
  local out=$1 err=$2
  # -T 30 is a pure backstop: the watcher exits the moment it matches, so a
  # generous deadline costs a passing run nothing and buys margin on a machine
  # where the control client is competing for CPU with the rest of the suite.
  "$WAIT_FOR_TEXT" --control -L "$SOCK" -t s -p "ready-control" -T 30 \
    >"$out" 2>"$err" 3>&- &
  local pid=$!
  wait_for_control_client || {
    kill "$pid" 2>/dev/null
    return 1
  }
  tx send-keys -t s "printf 'ready-control\n'" Enter || return 1
  wait "$pid" || {
    echo "wait-for-text exited non-zero. stderr:" >&2
    cat "$err" >&2
    echo "pane capture:" >&2
    tx capture-pane -pt s >&2
    return 1
  }
}

run_control_tail_target_filter() {
  local pane0=$1 pane1=$2 out=$3 err=$4
  # -T 30: a backstop, not a budget - see run_wait_for_text_control.
  "$CONTROL_TAIL" -L "$SOCK" -t "$pane1" -p "target-only" -T 30 \
    >"$out" 2>"$err" 3>&- &
  local pid=$!
  wait_for_control_client || {
    kill "$pid" 2>/dev/null
    return 1
  }

  # The non-target pane emits first. Waiting for it to render is what makes the
  # negative claim mean anything: the tail was attached and the output did
  # happen, so still being alive is evidence it filtered rather than evidence it
  # never saw anything.
  tx send-keys -t "$pane0" "printf 'target-only\n'" Enter || return 1
  wait_until_visible "$pane0" "target-only" || return 1
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" || true
    echo "matched non-target pane" >&2
    return 1
  fi

  tx send-keys -t "$pane1" "printf 'target-only\n'" Enter || return 1
  wait "$pid" || {
    echo "control-tail exited non-zero. stderr:" >&2
    cat "$err" >&2
    echo "pane1 capture:" >&2
    tx capture-pane -pt "$pane1" >&2
    return 1
  }
}

run_control_tail_timeout() {
  local out=$1 err=$2
  # -T is a backstop, not a budget: the sentinel is only in the tail buffer once
  # it has rendered, and this waits for that before letting the deadline run.
  "$CONTROL_TAIL" -L "$SOCK" -t s -p "missing-pattern" -T 15 --no-seed \
    >"$out" 2>"$err" 3>&- &
  local pid=$!
  wait_for_control_client || {
    kill "$pid" 2>/dev/null
    return 1
  }
  tx send-keys -t s "printf 'tail-sentinel\n'" Enter || return 1
  wait_until_visible s "tail-sentinel" || return 1
  wait "$pid"
}

@test "control-tail protocol helpers decode tmux payloads and normalise text" {
  run python3 - "$CONTROL_TAIL" <<'PY'
import importlib.util
import sys

path = sys.argv[1]
spec = importlib.util.spec_from_file_location("control_tail", path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.decode_tmux_payload(b"one\\012two\\134three") == b"one\ntwo\\three"
assert module.decode_tmux_payload(b"bad\\99escape") == b"bad\\99escape"
assert module.normalise_terminal_text("\x1b[31mred\x1b[0m\rnext\x1b]0;title\x07") == "red\nnext"
PY

  [ "$status" -eq 0 ]
}

@test "control-tail parses output and extended-output notifications" {
  run python3 - "$CONTROL_TAIL" <<'PY'
import importlib.util
import sys

path = sys.argv[1]
spec = importlib.util.spec_from_file_location("control_tail", path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.parse_output_line(b"%output %1 hello\\040world\n") == (b"%1", b"hello\\040world")
assert module.parse_output_line(b"%extended-output %2 17 future ignored : hello world\n") == (b"%2", b"hello world")
assert module.parse_output_line(b"%extended-output %2 17 future ignored\n") is None
assert module.parse_output_line(b"%window-add @1\n") is None
PY

  [ "$status" -eq 0 ]
}

@test "wait-for-text capture mode finds existing visible text" {
  start_session
  tx send-keys -t s "printf 'ready-capture\n'" Enter
  wait_until_visible s "ready-capture"

  run "$WAIT_FOR_TEXT" -L "$SOCK" -t s -p "ready-capture" -T 2 -i 0.1

  [ "$status" -eq 0 ]
  [[ "$output" == *"Pattern 'ready-capture' found"* ]]
}

@test "wait-for-text control mode finds text emitted after watcher start" {
  start_session
  local out="$BATS_TEST_TMPDIR/out"
  local err="$BATS_TEST_TMPDIR/err"

  run run_wait_for_text_control "$out" "$err"

  [ "$status" -eq 0 ]
  [[ "$(cat "$out")" == *"Pattern 'ready-control' found"* ]]
  [[ "$(cat "$err")" == "" ]]
}

@test "wait-for-text control mode matches already visible text via seed" {
  start_session
  tx send-keys -t s "printf 'already-visible\n'" Enter
  wait_until_visible s "already-visible"

  run "$WAIT_FOR_TEXT" --control -L "$SOCK" -t s -p "already-visible" -T 1

  [ "$status" -eq 0 ]
  [[ "$output" == *"Pattern 'already-visible' found in existing output"* ]]
}

@test "control-tail filters target pane output" {
  start_session
  # shellcheck disable=SC2046  # deliberate word split, see start_session
  tx split-window -t s -h $(pane_shell)

  local pane0
  local pane1
  pane0="$(tx display-message -p -t s:0.0 '#{pane_id}')"
  pane1="$(tx display-message -p -t s:0.1 '#{pane_id}')"
  wait_for_prompt "$pane1"

  local out="$BATS_TEST_TMPDIR/out"
  local err="$BATS_TEST_TMPDIR/err"

  run run_control_tail_target_filter "$pane0" "$pane1" "$out" "$err"

  [ "$status" -eq 0 ]
  [[ "$(cat "$out")" == *"Pattern 'target-only' found"* ]]
  [[ "$(cat "$err")" == "" ]]
}

@test "control-tail timeout exits non-zero and prints recent normalised tail" {
  start_session
  local out="$BATS_TEST_TMPDIR/out"
  local err="$BATS_TEST_TMPDIR/err"

  run run_control_tail_timeout "$out" "$err"

  [ "$status" -eq 1 ]
  [[ "$(cat "$out")" == "" ]]
  [[ "$(cat "$err")" == *"Timeout after 15s waiting for pattern 'missing-pattern'"* ]]
  [[ "$(cat "$err")" == *"tail-sentinel"* ]] || {
    echo "--- stderr ---" >&2
    cat "$err" >&2
    echo "--- pane ---" >&2
    tx capture-pane -pt s >&2
    false
  }
}

@test "find-sessions supports named tmux sockets" {
  start_session

  run "$FIND_SESSIONS" -L "$SOCK" -q '^s$'

  [ "$status" -eq 0 ]
  [ "$output" = "s" ]
}
