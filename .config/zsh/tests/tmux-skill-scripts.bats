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

start_session() {
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 100 -y 24 /bin/bash --noprofile --norc
}

wait_until_visible() {
  local target=$1
  local pattern=$2

  for _ in {1..40}; do
    if tx capture-pane -pt "$target" | grep -qE "$pattern"; then
      return 0
    fi
    sleep 0.05
  done
  return 1
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

  run bash -c '
    set -euo pipefail
    wait_script=$1
    sock=$2
    tmux_bin=$3
    out=$4
    err=$5

    "$wait_script" --control -L "$sock" -t s -p "ready-control" -T 3 >"$out" 2>"$err" &
    pid=$!
    sleep 0.3
    "$tmux_bin" -L "$sock" send-keys -t s "printf '\''ready-control\n'\''" Enter
    wait "$pid"
  ' _ "$WAIT_FOR_TEXT" "$SOCK" "$TMUX_BIN" "$out" "$err"

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
  tx split-window -t s -h /bin/bash --noprofile --norc

  local pane0
  local pane1
  pane0="$(tx display-message -p -t s:0.0 '#{pane_id}')"
  pane1="$(tx display-message -p -t s:0.1 '#{pane_id}')"

  local out="$BATS_TEST_TMPDIR/out"
  local err="$BATS_TEST_TMPDIR/err"

  run bash -c '
    set -euo pipefail
    control_tail=$1
    sock=$2
    tmux_bin=$3
    pane0=$4
    pane1=$5
    out=$6
    err=$7

    "$control_tail" -L "$sock" -t "$pane1" -p "target-only" -T 4 >"$out" 2>"$err" &
    pid=$!
    sleep 0.3
    "$tmux_bin" -L "$sock" send-keys -t "$pane0" "printf '\''target-only\n'\''" Enter
    sleep 0.4
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || true
      echo "matched non-target pane" >&2
      exit 1
    fi
    "$tmux_bin" -L "$sock" send-keys -t "$pane1" "printf '\''target-only\n'\''" Enter
    wait "$pid"
  ' _ "$CONTROL_TAIL" "$SOCK" "$TMUX_BIN" "$pane0" "$pane1" "$out" "$err"

  [ "$status" -eq 0 ]
  [[ "$(cat "$out")" == *"Pattern 'target-only' found"* ]]
  [[ "$(cat "$err")" == "" ]]
}

@test "control-tail timeout exits non-zero and prints recent normalised tail" {
  start_session
  local out="$BATS_TEST_TMPDIR/out"
  local err="$BATS_TEST_TMPDIR/err"

  run bash -c '
    set -euo pipefail
    control_tail=$1
    sock=$2
    tmux_bin=$3
    out=$4
    err=$5

    "$control_tail" -L "$sock" -t s -p "missing-pattern" -T 0.8 --no-seed >"$out" 2>"$err" &
    pid=$!
    sleep 0.2
    "$tmux_bin" -L "$sock" send-keys -t s "printf '\''tail-sentinel\n'\''" Enter
    wait "$pid"
  ' _ "$CONTROL_TAIL" "$SOCK" "$TMUX_BIN" "$out" "$err"

  [ "$status" -eq 1 ]
  [[ "$(cat "$out")" == "" ]]
  [[ "$(cat "$err")" == *"Timeout after 0.8s waiting for pattern 'missing-pattern'"* ]]
  [[ "$(cat "$err")" == *"tail-sentinel"* ]]
}

@test "find-sessions supports named tmux sockets" {
  start_session

  run "$FIND_SESSIONS" -L "$SOCK" -q '^s$'

  [ "$status" -eq 0 ]
  [ "$output" = "s" ]
}
