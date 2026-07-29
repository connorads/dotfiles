#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031
# rl (ralph loop) regression tests
# Run: bats ~/.config/zsh/tests/rl.bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

RL="$FUNCTIONS_DIR/agents/rl"
RL_KILL="$FUNCTIONS_DIR/agents/rl-kill"

setup_file() {
  # A hang backstop, not a budget. Several tests drive rl through its SIGINT
  # paths, and a mishandled signal leaves `wait` blocked on a helper's
  # `sleep 300` - five minutes in which the suite looks hung rather than a test
  # that failed. Nothing here should take anywhere near this.
  export BATS_TEST_TIMEOUT=120
}

setup() {
  setup_test_home
}

# rl-kill reads only the session registry rl writes, so pointing
# AGENT_USAGE_STATE_DIR at a temp dir makes even the kill test hermetic: rl-kill
# can only ever signal a process group named in that registry, and nothing real
# is ever named there.
rl_registry_setup() {
  export AGENT_USAGE_STATE_DIR="$BATS_TEST_TMPDIR/state"
  RL_REGISTRY="$AGENT_USAGE_STATE_DIR/rl-registry"
  mkdir -p "$RL_REGISTRY"
}

# write_registry_record <session> <rl_pid> <leader_pid> <pgid>
write_registry_record() {
  printf '%s\t%s\n' \
    session "$1" \
    rl_pid "$2" \
    started 1234567890 \
    leader_pid "$3" \
    pgid "$4" \
    iteration 1 \
    cmd "sleep 300" \
    >"$RL_REGISTRY/${1//:/-}"
}

# Spawn a real process into its own group — the perl -MPOSIX idiom rl uses —
# and set LEADER_PID / LEADER_PGID once setsid has taken effect.
spawn_group_leader() {
  perl -MPOSIX=setsid -e 'POSIX::setsid(); exec "sleep", "300"' </dev/null >/dev/null 2>&1 &
  LEADER_PID=$!
  wait_until -i 0.1 -d 'ps -o pid=,pgid= -p "$LEADER_PID"' '_leader_group_settled'
}

_leader_group_settled() {
  LEADER_PGID=$(ps -o pgid= -p "$LEADER_PID" 2>/dev/null | tr -d ' ')
  [ "$LEADER_PGID" = "$LEADER_PID" ]
}

# True once a pid is gone, or a zombie its parent has not reaped yet. `kill -0`
# succeeds on a zombie, so "still signalable" is not the same as "still alive" -
# a poll that only asks `kill -0` waits for the reap, which may never come.
_process_reaped() {
  kill -0 "$1" 2>/dev/null || return 0
  case "$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')" in
  Z*) return 0 ;;
  esac
  return 1
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
  # A plain `while read` loop, not `mapfile`: this runs under bats's own bash,
  # which on macOS is Apple's 3.2 and has no mapfile.
  local lines=() line
  while IFS= read -r line; do lines+=("$line"); done <"$SEQ_LOG"
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

  echo 0 >"$BATS_TEST_TMPDIR/count"
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
  # No retry pause on the final iteration - nothing follows it.
  [[ "$output" != *"pausing"* ]]
}

@test "retry pause occurs between failing iterations but not after the last" {
  local helper="$BATS_TEST_TMPDIR/always_fail_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
exit 1
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/always-fail-count"
  export RL_RETRY_PAUSE_SECS=0

  run zsh "$RL" 2 -- "$helper"

  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  # Pause between iter 1 and 2, but not after iter 2 (the last).
  local pausing
  pausing=$(grep -c "pausing" <<<"$output")
  [ "$pausing" -eq 1 ]
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
  export RL_RETRY_PAUSE_SECS=0

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
  # No cooldown at all, so the second INT force-stops unconditionally. The old
  # 0.3s window had to be out-waited by a fixed 0.5s sleep, and that sleep was
  # measured from the `kill` while rl measures the window from the moment it
  # *handled* the signal - two clocks that only agree on an idle machine. The
  # window's own behaviour is covered by the debounce test below.
  export RL_FORCE_STOP_WINDOW_SECS=0

  zsh "$RL" -- "$helper" >"$output_file" 2>&1 &
  local rl_pid=$!
  wait_until -i 0.1 '[ -f "$RL_CHILD_PID_FILE" ] && [ -f "$RL_GRANDCHILD_PID_FILE" ]'

  local child_pid
  local grandchild_pid
  child_pid=$(cat "$RL_CHILD_PID_FILE")
  grandchild_pid=$(cat "$RL_GRANDCHILD_PID_FILE")

  # rl announces the first INT, which is the only observable saying it has been
  # handled rather than merely delivered.
  kill -INT "$rl_pid"
  wait_until -d 'cat "$output_file"' \
    'grep -Fq "stopping after current iteration" "$output_file"'
  kill -INT "$rl_pid"
  local exit_status
  if wait "$rl_pid"; then
    exit_status=0
  else
    exit_status=$?
  fi

  [ "$exit_status" -eq 130 ]
  wait_until -d 'ps -o pid=,stat=,command= -p "$child_pid"' "_process_reaped $child_pid"
  wait_until -d 'ps -o pid=,stat=,command= -p "$grandchild_pid"' "_process_reaped $grandchild_pid"
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
  # A window wide enough that no amount of scheduling jitter can put the second
  # INT outside it. At 0.3s "rapid" was a claim about the test's own timing on
  # an idle machine; at 30s it is a property of the run.
  export RL_FORCE_STOP_WINDOW_SECS=30

  zsh "$RL" -- "$helper" >"$output_file" 2>&1 &
  local rl_pid=$!

  wait_until -i 0.1 '[ -f "$RL_CHILD_PID_FILE" ]'

  # Both INTs land inside the window. Each is driven off rl's own announcement,
  # so "rapid" no longer depends on how fast the test happens to be scheduled.
  kill -INT "$rl_pid"
  wait_until -d 'cat "$output_file"' \
    'grep -Fq "stopping after current iteration" "$output_file"'
  kill -INT "$rl_pid"
  wait_until -d 'cat "$output_file"' 'grep -Fq "hold on" "$output_file"'

  # Still running: the debounce blocked the force-stop.
  kill -0 "$rl_pid" 2>/dev/null
  ! grep -Fq "force stopping" "$output_file"

  # Cleaned up by signal, not by out-waiting the window: a debounced INT leaves
  # `wait` blocked on the helper's `sleep 300` - 300s of a suite that looks hung.
  kill -KILL "$(cat "$RL_CHILD_PID_FILE")" 2>/dev/null || true
  kill -KILL "$rl_pid" 2>/dev/null || true
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

@test "rl records a live session and removes the record on a clean exit" {
  rl_registry_setup
  export RECORD_MARKER="$BATS_TEST_TMPDIR/record.copy"
  local helper="$BATS_TEST_TMPDIR/probe_cmd.sh"
  # The record is written once refresh_child_pgid resolves the group, i.e.
  # shortly after this starts - so poll rather than look once.
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
for _ in $(seq 30); do
  if [ -n "$(ls -A "$AGENT_USAGE_STATE_DIR/rl-registry" 2>/dev/null)" ]; then
    cat "$AGENT_USAGE_STATE_DIR"/rl-registry/* >"$RECORD_MARKER"
    exit 0
  fi
  sleep 0.1
done
exit 1
SCRIPT

  run zsh "$RL" 1 -- "$helper"

  [ "$status" -eq 0 ]
  grep -q "^rl_pid	" "$RECORD_MARKER"
  grep -q "^pgid	" "$RECORD_MARKER"
  # Gone once rl returns: a record that outlives its rl IS the orphan signal.
  [ -z "$(ls -A "$RL_REGISTRY")" ]
}

@test "rl-kill lists an orphaned session from the registry" {
  rl_registry_setup
  spawn_group_leader
  # A real group of ours, recorded against an rl pid that no longer exists.
  write_registry_record "99999:1234567890" 99999 "$LEADER_PID" "$LEADER_PGID"

  run zsh "$RL_KILL" -l

  [ "$status" -eq 0 ]
  [[ "$output" == *"99999:1234567890"* ]]
  [[ "$output" == *"orphaned"* ]]

  kill -TERM -"$LEADER_PGID" 2>/dev/null || true
}

@test "rl-kill skips a session whose rl is still running" {
  rl_registry_setup
  write_registry_record "$$:1234567890" "$$" "$$" "$$"

  run zsh "$RL_KILL" -l

  [ "$status" -eq 0 ]
  [[ "$output" == *"no orphaned"* ]]
  [[ "$output" == *"1 active session(s)"* ]]
}

@test "rl-kill prunes a record whose process group is gone" {
  rl_registry_setup
  # leader_pid 99998 is either absent or (if recycled) in some other group;
  # either way the recorded group no longer exists.
  write_registry_record "99999:1234567890" 99999 99998 99998

  run zsh "$RL_KILL" -l

  [ "$status" -eq 0 ]
  [[ "$output" != *"99999:1234567890"* ]]
  [ ! -f "$RL_REGISTRY/99999-1234567890" ]
}

@test "rl-kill reaps the recorded process group" {
  rl_registry_setup
  spawn_group_leader
  write_registry_record "99999:1234567890" 99999 "$LEADER_PID" "$LEADER_PGID"

  run zsh "$RL_KILL" -f

  [ "$status" -eq 0 ]
  # Not a bare `kill -0`: the leader is this shell's own background job, so
  # between the TERM landing and this shell reaping it the pid is a zombie -
  # signalable, and therefore "alive" to `kill -0` - and the assertion had no
  # poll at all besides.
  wait_until -d 'ps -o pid=,stat=,command= -p "$LEADER_PID"' "_process_reaped $LEADER_PID"
  [ ! -f "$RL_REGISTRY/99999-1234567890" ]
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
  export RL_RETRY_PAUSE_SECS=0

  # 5s, not a sub-second value: the timeout arms before the child's
  # setsid->zsh->perl startup chain reaches the helper body, and under the
  # parallel runner's load that chain can outlast a 0.5s timeout - the watchdog
  # then kills the child before it writes COUNT_FILE, so the counter never
  # reaches 2 (flaky under -j, fine in isolation). The margin must clear
  # worst-case startup yet stay far below the 300s hang so the timeout still
  # fires.
  run zsh "$RL" 2 -t 5s -- "$helper"

  # Both iterations should have run (timeout killed the first, second ran normally)
  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  # Output should mention the timeout
  [[ "$output" == *"timed out"* ]]
}

@test "timeout still fires when the child's process group cannot be detected" {
  # Regression: refresh_child_pgid can lose its ~1s ps-polling race under load and
  # leave child_pgid empty. The watchdog must still arm (keyed on -t alone) and fall
  # back to killing child_pid, rather than silently letting a stuck iteration run
  # unbounded. A fake ps that always reports one pgid makes the child's group appear
  # identical to the parent's, so refresh_child_pgid gives up - the exact failure.
  write_stub ps <<'SCRIPT'
#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == pgid=* || "$a" == -o ]] && { echo 12345; exit 0; }; done
exit 0
SCRIPT

  local helper="$BATS_TEST_TMPDIR/nopgid_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNT_FILE"
if [ "$n" -eq 1 ]; then
  # exec, and fds detached from rl: whatever the watchdog ends up killing, no
  # survivor is left holding rl's stdout - which `run` would otherwise wait on,
  # making the passing path pay this sleep in full. Bounded, so an unarmed
  # watchdog fails on the assertions rather than on the file's hang backstop.
  exec sleep 60 </dev/null >/dev/null 2>&1
fi
exit 0
SCRIPT

  export COUNT_FILE="$BATS_TEST_TMPDIR/nopgid_count"
  export RL_RETRY_PAUSE_SECS=0

  # 5s, not 0.5s - the same fix the sibling test above already carries. The
  # watchdog arms before the child's setsid->zsh startup chain reaches the
  # helper body, so under load a sub-second timeout kills the child before it
  # writes COUNT_FILE and the counter never reaches 2. The helper's own sleep
  # grows with it, so an unarmed watchdog is still told apart from a firing one.
  run zsh "$RL" 2 -t 5s -- "$helper"

  [ "$(cat "$COUNT_FILE")" -eq 2 ]
  [[ "$output" == *"timed out"* ]]
}

@test "timeout accepts fractional durations" {
  local helper="$BATS_TEST_TMPDIR/frac_cmd.sh"
  write_executable "$helper" <<'SCRIPT'
#!/usr/bin/env bash
sleep 300
SCRIPT

  export RL_RETRY_PAUSE_SECS=0

  run zsh "$RL" 1 -t 0.5s -- "$helper"

  # A sub-second timeout must actually fire on a child that outlives it - asserting
  # status 0 on an instant child passed even when 0.5s silently truncated to 0.
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
