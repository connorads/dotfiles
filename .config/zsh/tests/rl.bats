#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031
# rl (ralph loop) regression tests
# Run: bats ~/.config/zsh/tests/rl.bats

bats_require_minimum_version 1.5.0

RL="$HOME/.config/zsh/functions/agents/rl"

# The critical bug: with MONITOR (job control) on, `setsid cmd &` puts setsid
# in its own process group, making it a pg leader. setsid then forks internally
# and the parent exits immediately, so `wait $pid` returns instantly and all
# iterations fire in parallel. MONITOR only activates on a real TTY, so we use
# script(1) to reproduce the interactive-shell condition.

@test "iterations run sequentially with job control (TTY)" {
  local helper="$BATS_TEST_TMPDIR/seq_cmd.sh"
  cat > "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$SEQ_COUNTER" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$SEQ_COUNTER"
echo "start-$n" >> "$SEQ_LOG"
sleep 0.3
echo "end-$n" >> "$SEQ_LOG"
SCRIPT
  chmod +x "$helper"

  export SEQ_COUNTER="$BATS_TEST_TMPDIR/counter"
  export SEQ_LOG="$BATS_TEST_TMPDIR/seq.log"

  # script(1) allocates a TTY so zsh enables MONITOR (job control)
  run script -qc "zsh --no-rcs -i -c 'source $RL 3 -- $helper'" /dev/null

  # Sequential: start-1, end-1, start-2, end-2, start-3, end-3
  # Parallel bug produces: start-1, start-2, start-3, end-1, end-2, end-3
  [ -f "$SEQ_LOG" ]
  local lines
  mapfile -t lines < "$SEQ_LOG"
  [ "${lines[0]}" = "start-1" ]
  [ "${lines[1]}" = "end-1" ]
  [ "${lines[2]}" = "start-2" ]
  [ "${lines[3]}" = "end-2" ]
  [ "${lines[4]}" = "start-3" ]
  [ "${lines[5]}" = "end-3" ]
}

@test "rl N runs exactly N iterations" {
  local helper="$BATS_TEST_TMPDIR/count_cmd.sh"
  cat > "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE")
echo $((n + 1)) > "$COUNT_FILE"
SCRIPT
  chmod +x "$helper"

  echo 0 > "$BATS_TEST_TMPDIR/count"
  export COUNT_FILE="$BATS_TEST_TMPDIR/count"

  run zsh "$RL" 5 -- "$helper"

  [ "$(cat "$COUNT_FILE")" -eq 5 ]
}

@test "child exit code is reported in output" {
  local helper="$BATS_TEST_TMPDIR/exit_cmd.sh"
  cat > "$helper" <<'SCRIPT'
#!/usr/bin/env bash
exit 42
SCRIPT
  chmod +x "$helper"

  run zsh "$RL" 1 -- "$helper"

  [[ "$output" == *"exit 42"* ]]
}

@test "double SIGINT force-stops the whole iteration tree" {
  local helper="$BATS_TEST_TMPDIR/tree_cmd.sh"
  local output_file="$BATS_TEST_TMPDIR/rl.out"
  cat > "$helper" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
echo "$$" > "$RL_CHILD_PID_FILE"
sleep 300 &
grandchild=$!
echo "$grandchild" > "$RL_GRANDCHILD_PID_FILE"
wait "$grandchild"
SCRIPT
  chmod +x "$helper"

  export RL_CHILD_PID_FILE="$BATS_TEST_TMPDIR/child.pid"
  export RL_GRANDCHILD_PID_FILE="$BATS_TEST_TMPDIR/grandchild.pid"

  zsh "$RL" -- "$helper" >"$output_file" 2>&1 &
  local rl_pid=$!
  local ready=0

  for _ in {1..50}; do
    if [[ -f "$RL_CHILD_PID_FILE" && -f "$RL_GRANDCHILD_PID_FILE" ]]; then
      ready=1
      break
    fi
    sleep 0.1
  done

  [ "$ready" -eq 1 ]
  [ -f "$RL_CHILD_PID_FILE" ]
  [ -f "$RL_GRANDCHILD_PID_FILE" ]

  local child_pid
  local grandchild_pid
  child_pid=$(cat "$RL_CHILD_PID_FILE")
  grandchild_pid=$(cat "$RL_GRANDCHILD_PID_FILE")

  kill -INT "$rl_pid"
  sleep 0.2
  kill -INT "$rl_pid"
  local exit_status
  if wait "$rl_pid"; then
    exit_status=0
  else
    exit_status=$?
  fi

  [ "$exit_status" -eq 130 ]
  run bash -c 'kill -0 "$1" 2>/dev/null' _ "$child_pid"
  [ "$status" -ne 0 ]
  run bash -c 'kill -0 "$1" 2>/dev/null' _ "$grandchild_pid"
  [ "$status" -ne 0 ]
  grep -Fq "force stopping" "$output_file"
}

@test "usage printed without -- separator" {
  run zsh "$RL" echo hello

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "usage printed with no arguments" {
  run zsh "$RL"

  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}
