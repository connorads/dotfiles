#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031
# rl (ralph loop) regression tests
# Run: bats ~/.config/zsh/tests/rl.bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

RL="$FUNCTIONS_DIR/agents/rl"
RL_KILL="$FUNCTIONS_DIR/agents/rl-kill"

setup() {
  setup_test_home
}

# The critical bug: with MONITOR (job control) on, `setsid cmd &` puts setsid
# in its own process group, making it a pg leader. setsid then forks internally
# and the parent exits immediately, so `wait $pid` returns instantly and all
# iterations fire in parallel. MONITOR only activates on a real TTY, so we use
# script(1) to reproduce the interactive-shell condition.

@test "iterations run sequentially with job control (TTY)" {
  local helper="$BATS_TEST_TMPDIR/seq_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$SEQ_COUNTER" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$SEQ_COUNTER"
echo "start-$n" >> "$SEQ_LOG"
sleep 0.3
echo "end-$n" >> "$SEQ_LOG"
SCRIPT

  export SEQ_COUNTER="$BATS_TEST_TMPDIR/counter"
  export SEQ_LOG="$BATS_TEST_TMPDIR/seq.log"

  # script(1) allocates a TTY so zsh enables MONITOR (job control)
  run_in_tty "source $RL 3 -- $helper"

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
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE")
echo $((n + 1)) > "$COUNT_FILE"
SCRIPT

  echo 0 > "$BATS_TEST_TMPDIR/count"
  export COUNT_FILE="$BATS_TEST_TMPDIR/count"

  run zsh "$RL" 5 -- "$helper"

  [ "$(cat "$COUNT_FILE")" -eq 5 ]
}

@test "child exit code is reported in output" {
  local helper="$BATS_TEST_TMPDIR/exit_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
exit 42
SCRIPT

  run zsh "$RL" 1 -- "$helper"

  [[ "$output" == *"exit 42"* ]]
}

@test "promise token stops loop after successful iteration" {
  local helper="$BATS_TEST_TMPDIR/promise_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "__PROMISE_RL_DONE__"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-count"

  run zsh "$RL" 5 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 1 ]
  [[ "$output" == *"promise token seen"* ]]
}

@test "promise token is detected through ANSI colour codes" {
  local helper="$BATS_TEST_TMPDIR/promise_ansi_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
printf '\033[32m__PROMISE_RL_DONE__\033[0m\n'
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-ansi-count"

  run zsh "$RL" 5 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 1 ]
}

@test "promise token mentioned before the final line does not stop the loop" {
  local helper="$BATS_TEST_TMPDIR/promise_mid_output_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "mentioning __PROMISE_RL_DONE__ in passing"
echo "still working"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-mid-output-count"

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" != *"promise token seen"* ]]
}

@test "promise token embedded in a longer final line does not stop the loop" {
  local helper="$BATS_TEST_TMPDIR/promise_embedded_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "done? __PROMISE_RL_DONE__ nope"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-embedded-count"

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" != *"promise token seen"* ]]
}

@test "promise token followed by another non-empty line does not stop the loop" {
  local helper="$BATS_TEST_TMPDIR/promise_not_final_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "__PROMISE_RL_DONE__"
echo "postscript"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-not-final-count"

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" != *"promise token seen"* ]]
}

@test "promise mode allocates a tty for interactive children" {
  local helper="$BATS_TEST_TMPDIR/promise_tty_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
if [[ -t 1 ]]; then
  echo "tty"
else
  echo "notty"
fi
echo "__PROMISE_RL_DONE__"
SCRIPT

  run_in_tty "env PATH=\"$PATH\" zsh --no-rcs \"$RL\" 2 -- \"$helper\""

  [ "$status" -eq 0 ]
  [[ "$output" == *"tty"* ]]
  [[ "$output" != *"notty"* ]]
  [[ "$output" == *"promise token seen"* ]]
}

@test "promise mode preserves ANSI output in a tty" {
  local helper="$BATS_TEST_TMPDIR/promise_tty_ansi_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
printf '\033[31mred\033[0m\n'
echo "__PROMISE_RL_DONE__"
SCRIPT

  run_in_tty "env PATH=\"$PATH\" zsh --no-rcs \"$RL\" 2 -- \"$helper\""

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[31mred\033[0m'* ]]
}

@test "promise mode falls back to non-tty behaviour when stdout is not a tty" {
  local helper="$BATS_TEST_TMPDIR/promise_notty_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
if [[ -t 1 ]]; then
  echo "tty"
else
  echo "notty"
fi
echo "__PROMISE_RL_DONE__"
SCRIPT

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [[ "$output" == *"notty"* ]]
  [[ "$output" != *$'\n'"tty"$'\n'* ]]
}

@test "promise token is ignored on non-zero exit" {
  local helper="$BATS_TEST_TMPDIR/promise_fail_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "__PROMISE_RL_DONE__"
if [ "$n" -eq 1 ]; then
  exit 7
fi
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-fail-count"

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" != *"promise token seen; stopping after iteration 1"* ]]
}

@test "custom promise token overrides the default" {
  local helper="$BATS_TEST_TMPDIR/promise_custom_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "__CUSTOM_DONE__"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-custom-count"

  run zsh "$RL" 5 --promise-token __CUSTOM_DONE__ -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 1 ]
}

@test "no-promise-token disables default early stop" {
  local helper="$BATS_TEST_TMPDIR/promise_disabled_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
echo "__PROMISE_RL_DONE__"
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/promise-disabled-count"

  run zsh "$RL" 2 --no-promise-token -- "$helper"

  [ "$status" -eq 0 ]
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" != *"promise token seen"* ]]
}

@test "double SIGINT force-stops the whole iteration tree" {
  local helper="$BATS_TEST_TMPDIR/tree_cmd.sh"
  local output_file="$BATS_TEST_TMPDIR/rl.out"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
echo "$$" > "$RL_CHILD_PID_FILE"
sleep 300 &
grandchild=$!
echo "$grandchild" > "$RL_GRANDCHILD_PID_FILE"
wait "$grandchild"
SCRIPT

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
  sleep 2.5  # must exceed 2s debounce cooldown
  kill -INT "$rl_pid"
  local exit_status
  if wait "$rl_pid"; then
    exit_status=0
  else
    exit_status=$?
  fi

  [ "$exit_status" -eq 130 ]
  local child_stopped=0
  for _ in {1..20}; do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      child_stopped=1
      break
    fi

    local child_state
    child_state=$(ps -o stat= -p "$child_pid" 2>/dev/null | tr -d ' ')
    if [[ "$child_state" == Z* ]]; then
      child_stopped=1
      break
    fi

    sleep 0.05
  done

  [ "$child_stopped" -eq 1 ]

  local grandchild_stopped=0
  for _ in {1..20}; do
    if ! kill -0 "$grandchild_pid" 2>/dev/null; then
      grandchild_stopped=1
      break
    fi

    local state
    state=$(ps -o stat= -p "$grandchild_pid" 2>/dev/null | tr -d ' ')
    if [[ "$state" == Z* ]]; then
      grandchild_stopped=1
      break
    fi

    sleep 0.05
  done

  [ "$grandchild_stopped" -eq 1 ]
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

@test "rapid double SIGINT is blocked by debounce" {
  local helper="$BATS_TEST_TMPDIR/debounce_cmd.sh"
  local output_file="$BATS_TEST_TMPDIR/rl.out"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
echo "$$" > "$RL_CHILD_PID_FILE"
sleep 300
SCRIPT

  export RL_CHILD_PID_FILE="$BATS_TEST_TMPDIR/child.pid"

  zsh "$RL" -- "$helper" >"$output_file" 2>&1 &
  local rl_pid=$!

  # Wait for child to start
  local ready=0
  for _ in {1..50}; do
    if [[ -f "$RL_CHILD_PID_FILE" ]]; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [ "$ready" -eq 1 ]

  # Send two SIGINTs rapidly (within debounce window)
  kill -INT "$rl_pid"
  sleep 0.1
  kill -INT "$rl_pid"
  sleep 0.5

  # rl should still be running (debounce blocked force-stop)
  kill -0 "$rl_pid" 2>/dev/null
  local still_running=$?
  [ "$still_running" -eq 0 ]

  # Output should contain the debounce message, not force-stop
  grep -Fq "hold on" "$output_file"
  ! grep -Fq "force stopping" "$output_file"

  # Clean up: wait for debounce then force-stop
  sleep 2
  kill -INT "$rl_pid" 2>/dev/null
  wait "$rl_pid" 2>/dev/null || true
}

@test "RL_SESSION is set in child environment" {
  local helper="$BATS_TEST_TMPDIR/session_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
echo "$RL_SESSION" > "$SESSION_FILE"
SCRIPT

  export SESSION_FILE="$BATS_TEST_TMPDIR/session.txt"

  run zsh "$RL" 1 -- "$helper"

  [ -f "$SESSION_FILE" ]
  local session
  session=$(cat "$SESSION_FILE")
  # Format: <pid>:<epoch>
  [[ "$session" =~ ^[0-9]+:[0-9]+$ ]]
}

@test "RL_USAGE_SESSION_FILE is set in child environment" {
  local helper="$BATS_TEST_TMPDIR/session_file_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
echo "$RL_USAGE_SESSION_FILE" > "$SESSION_FILE"
SCRIPT

  export SESSION_FILE="$BATS_TEST_TMPDIR/session-file.txt"

  run zsh "$RL" 1 -- "$helper"

  [ -f "$SESSION_FILE" ]
  local session_file
  session_file=$(cat "$SESSION_FILE")
  [[ "$session_file" == "$HOME/.local/state/agents/rl-sessions/"*".jsonl" ]]
}

@test "RL_* variables do not leak after rl returns in the same shell" {
  local helper="$BATS_TEST_TMPDIR/session_scope_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s|%s|%s\n' "$RL_SESSION" "$RL_USAGE_SESSION_FILE" "$RL_ITERATION" > "$INSIDE_FILE"
SCRIPT

  export INSIDE_FILE="$BATS_TEST_TMPDIR/inside-vars.txt"

  run zsh -c '
    set -e
    rl() { source "'"$RL"'" "$@"; }
    rl 1 -- "'"$helper"'"
    printf "<LAST>%s|%s|%s</LAST>\n" "${RL_SESSION-unset}" "${RL_USAGE_SESSION_FILE-unset}" "${RL_ITERATION-unset}"
  '

  [ "$status" -eq 0 ]
  [ -f "$INSIDE_FILE" ]
  [[ "$(cat "$INSIDE_FILE")" =~ ^[0-9]+:[0-9]+\|.*/rl-sessions/.*\.jsonl\|1$ ]]
  [[ "$output" == *"<LAST>unset|unset|unset</LAST>"* ]]
}

@test "rl can be sourced from another directory" {
  local helper="$BATS_TEST_TMPDIR/sourced_rl_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
echo ok
SCRIPT

  run zsh -c '
    mkdir -p "'"$BATS_TEST_TMPDIR"'/caller"
    cd "'"$BATS_TEST_TMPDIR"'/caller"
    source "'"$RL"'" 1 -- "'"$helper"'"
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"finished after 1 iterations"* ]]
}

@test "rl autoload resolves sibling helpers from fpath" {
  run zsh -fc '
    fpath=("/home/connor/.config/zsh/functions/agents" $fpath)
    autoload -Uz rl
    rl 1 -- true
  '

  [ "$status" -eq 0 ]
  [[ "$output" == *"finished after 1 iterations"* ]]
  [[ "$output" != *"agent_usage_state_dir: command not found"* ]]
}

@test "rl prints aggregate totals from session usage log" {
  local helper="$BATS_TEST_TMPDIR/usage_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
cat >> "$RL_USAGE_SESSION_FILE" <<JSON
{"provider":"claude","runner":"cys","input_tokens":3,"cached_input_tokens":7,"output_tokens":4,"duration_ms":1200,"total_cost_usd":0.01}
JSON
SCRIPT

  run zsh "$RL" 2 -- "$helper"

  [ "$status" -eq 0 ]
  [[ "$output" == *"total, in 6, cached 14, out 8, 2.4s, \$0.02 across 2 runs"* || "$output" == *"total, in 6, cached 14, out 8, 2.4s, \$0.0200 across 2 runs"* ]]
}

@test "rl-kill lists orphaned processes" {
  # Spawn a process with a fake RL_SESSION (simulating an orphan)
  RL_SESSION="99999:1234567890" sleep 300 &
  local orphan_pid=$!

  run zsh "$RL_KILL" -l

  # Should find the orphan (PID 99999 doesn't exist)
  [[ "$output" == *"99999:1234567890"* ]]
  [[ "$output" == *"orphaned"* ]]

  # Clean up
  kill "$orphan_pid" 2>/dev/null
  wait "$orphan_pid" 2>/dev/null || true
}

@test "rl-kill force-kills orphaned processes" {
  RL_SESSION="99999:1234567890" sleep 300 &
  local orphan_pid=$!

  run zsh "$RL_KILL" -f

  # Process should be gone
  sleep 0.2
  ! kill -0 "$orphan_pid" 2>/dev/null
}

@test "timeout kills stuck iteration and moves to next" {
  local helper="$BATS_TEST_TMPDIR/stuck_cmd.sh"
  local output_file="$BATS_TEST_TMPDIR/rl.out"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
if [ "$n" -eq 1 ]; then
  sleep 300  # first iteration hangs
else
  exit 0     # second iteration succeeds
fi
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/timeout_count"

  run zsh "$RL" 2 -t 2s -- "$helper"

  # Both iterations should have run (timeout killed the first, second ran normally)
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  # Output should mention the timeout
  [[ "$output" == *"timed out"* ]]
}

@test "timeout parses duration units (s, m, h and bare number)" {
  local helper="$BATS_TEST_TMPDIR/fast_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT

  # All of these should parse without error and run 1 iteration
  run zsh "$RL" 1 -t 60s -- "$helper"
  [ "$status" -eq 0 ]

  run zsh "$RL" 1 -t 1m -- "$helper"
  [ "$status" -eq 0 ]

  run zsh "$RL" 1 -t 1h -- "$helper"
  [ "$status" -eq 0 ]

  run zsh "$RL" 1 -t 60 -- "$helper"
  [ "$status" -eq 0 ]
}

@test "unknown option prints error" {
  run zsh "$RL" --bogus -- echo hi

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown option"* ]]
}

@test "rl-kill skips active sessions" {
  # Use our own PID as the parent — it's alive, so not orphaned
  RL_SESSION="$$:1234567890" sleep 300 &
  local active_pid=$!

  run zsh "$RL_KILL" -l

  # Should report no orphans
  [[ "$output" == *"no orphaned"* ]]

  # Clean up
  kill "$active_pid" 2>/dev/null
  wait "$active_pid" 2>/dev/null || true
}
