#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it
# for an isolated temp dir. The lib is sourced against the isolated HOME; state
# is driven with real pidfiles under CAFFEINE_PIDFILE (env-overridable default),
# so no clock stubbing is needed.
CALF_LIB="$HOME/.config/tmux/scripts/caffeine-lib.sh"

setup() {
  setup_test_home
  export CAFFEINE_PIDFILE="$HOME/.cache/tmux-caffeinate.pid"
  mkdir -p "$HOME/.cache"
}

lib() {
  run bash -c "source '$CALF_LIB'; $*"
}

# Write "pid deadline" to the pidfile — the two-field form written before lid
# mode existed, kept as the backwards-compatibility fixture.
pidfile() {
  printf '%s %s\n' "$1" "$2" >"$CAFFEINE_PIDFILE"
}

# Write the current three-field form "pid deadline mode".
pidfile3() {
  printf '%s %s %s\n' "$1" "$2" "$3" >"$CAFFEINE_PIDFILE"
}

# Stub `pmset -g`, whose output caffeine_sleep_disabled parses. The real pmset
# omits the SleepDisabled key entirely when the flag is clear, so the stub does
# too — that absence is the case the parser has to get right.
stub_pmset() {
  local flag=$1
  write_stub pmset <<EOF
#!/usr/bin/env bash
[ "\$1" = "-g" ] || exit 0
printf 'System-wide power settings:\nCurrently in use:\n sleep 1\n disksleep 10\n'
[ "$flag" = "absent" ] || printf ' SleepDisabled %s\n' "$flag"
EOF
}

# --- pidfile default resolution --------------------------------------------

@test "CAFFEINE_PIDFILE honours an env override" {
  CAFFEINE_PIDFILE="$HOME/custom.pid" lib 'printf %s "$CAFFEINE_PIDFILE"'
  [ "$output" = "$HOME/custom.pid" ]
}

@test "CAFFEINE_PIDFILE defaults under ~/.cache when unset" {
  run bash -c "unset CAFFEINE_PIDFILE; source '$CALF_LIB'; printf %s \"\$CAFFEINE_PIDFILE\""
  [ "$output" = "$HOME/.cache/tmux-caffeinate.pid" ]
}

# --- state: liveness of the managed pid ------------------------------------

@test "OFF when no pidfile exists" {
  lib caffeine_state
  [ "$output" = "OFF" ]
}

@test "OFF for a stale pidfile whose pid is dead" {
  # Spawn a process, record its pid, then kill+reap it so the pidfile is stale.
  sleep 100 &
  dead=$!
  kill "$dead" 2>/dev/null || true
  wait "$dead" 2>/dev/null || true
  pidfile "$dead" 0
  lib caffeine_state
  [ "$output" = "OFF" ]
}

@test "ON for a live managed pid" {
  sleep 100 &
  pid=$!
  pidfile "$pid" 0
  lib caffeine_state
  kill "$pid" 2>/dev/null || true
  [ "$output" = "ON" ]
}

# --- mode: the pidfile's third field ---------------------------------------

@test "mode defaults to idle for a two-field pidfile" {
  # The backwards-compatibility contract: a pidfile written before lid mode
  # existed keeps working, with no migration.
  pidfile 123 0
  lib caffeine_mode
  [ "$output" = "idle" ]
}

@test "mode is idle when no pidfile exists" {
  lib caffeine_mode
  [ "$output" = "idle" ]
}

@test "mode reads lid from the third field" {
  future=$(($(date +%s) + 600))
  pidfile3 123 "$future" lid
  lib caffeine_mode
  [ "$output" = "lid" ]
}

@test "an unrecognised third field reads as idle, never lid" {
  # Fail towards the unprivileged mode: a garbled field must not let anything
  # claim the mode that holds a kernel flag.
  pidfile3 123 0 wat
  lib caffeine_mode
  [ "$output" = "idle" ]
}

# --- state: ON-LID ----------------------------------------------------------

@test "ON-LID for a live pid in lid mode" {
  sleep 100 &
  pid=$!
  future=$(($(date +%s) + 600))
  pidfile3 "$pid" "$future" lid
  lib caffeine_state
  kill "$pid" 2>/dev/null || true
  [ "$output" = "ON-LID" ]
}

@test "ON for a live pid explicitly in idle mode" {
  sleep 100 &
  pid=$!
  pidfile3 "$pid" 0 idle
  lib caffeine_state
  kill "$pid" 2>/dev/null || true
  [ "$output" = "ON" ]
}

@test "OFF for a stale lid pidfile whose supervisor is dead" {
  # The pill must not claim ON-LID for a supervisor that has gone; the kernel
  # flag it left behind is the reconciler's job, not the state's.
  sleep 100 &
  dead=$!
  kill "$dead" 2>/dev/null || true
  wait "$dead" 2>/dev/null || true
  future=$(($(date +%s) + 600))
  pidfile3 "$dead" "$future" lid
  lib caffeine_state
  [ "$output" = "OFF" ]
}

@test "caffeine_state never shells out to pmset" {
  # It renders on every status tick, so a fork per tick is the bug. A pmset stub
  # that fails loudly proves the state path never reaches it.
  write_stub pmset <<'EOF'
#!/usr/bin/env bash
echo "caffeine_state must not fork pmset" >&2
exit 99
EOF
  sleep 100 &
  pid=$!
  pidfile3 "$pid" 0 lid
  lib caffeine_state
  kill "$pid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [ "$output" = "ON-LID" ]
}

# --- remaining seconds and the deadline field ------------------------------

@test "remaining_secs is -1 for an indefinite deadline" {
  pidfile 123 0
  lib caffeine_remaining_secs
  [ "$output" = "-1" ]
}

@test "remaining_secs is positive and bounded for a future deadline" {
  future=$(($(date +%s) + 600))
  pidfile 123 "$future"
  lib caffeine_remaining_secs
  [ "$output" -gt 0 ]
  [ "$output" -le 600 ]
}

@test "remaining_secs clamps a past deadline to 0" {
  past=$(($(date +%s) - 60))
  pidfile 123 "$past"
  lib caffeine_remaining_secs
  [ "$output" = "0" ]
}

# --- wall clock -------------------------------------------------------------

@test "clock_at renders local wall-clock HH:MM" {
  # Portability is the point: BSD date takes -r and GNU date takes -d @, and the
  # lib has to work on whichever this host has.
  lib "caffeine_clock_at $(date +%s)"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9][0-9]:[0-9][0-9]$ ]]
}

@test "clock_at moves with the epoch it is given" {
  now=$(date +%s)
  lib "caffeine_clock_at $now"
  local at_now=$output
  lib "caffeine_clock_at $((now + 3600))"
  [ "$output" != "$at_now" ]
}

# --- extending a running session --------------------------------------------

@test "extend_total adds to what is LEFT, not to the original duration" {
  # The distinction is the whole feature: setting a fresh total would silently
  # shorten a session with more left on it than the amount picked.
  sleep 100 &
  pid=$!
  future=$(($(date +%s) + 600))
  pidfile3 "$pid" "$future" idle
  lib 'caffeine_extend_total 1800'
  kill "$pid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [ "$output" -gt 2390 ]
  [ "$output" -le 2400 ]
}

@test "extend_total refuses when nothing is running" {
  lib 'caffeine_extend_total 1800'
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "extend_total refuses a non-positive or non-numeric addition" {
  lib 'caffeine_extend_total 0'
  [ "$status" -eq 2 ]
  lib 'caffeine_extend_total abc'
  [ "$status" -eq 2 ]
  lib 'caffeine_extend_total'
  [ "$status" -eq 2 ]
}

@test "extend_total refuses an indefinite session" {
  # Nothing bounded to add to; the popup hides the key in this state for the
  # same reason.
  sleep 100 &
  pid=$!
  pidfile3 "$pid" 0 idle
  lib 'caffeine_extend_total 1800'
  kill "$pid" 2>/dev/null || true
  [ "$status" -eq 3 ]
  [ -z "$output" ]
}

@test "extend_total keeps a lid session bounded" {
  # A lid extension is still a timed session, so the always-timed invariant
  # survives any number of extensions.
  sleep 100 &
  pid=$!
  future=$(($(date +%s) + 600))
  pidfile3 "$pid" "$future" lid
  lib 'caffeine_extend_total 1800'
  kill "$pid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [ "$output" -gt 0 ]
}

# --- token: figure-slot content --------------------------------------------

@test "token is the infinity glyph for an indefinite deadline" {
  pidfile 123 0
  lib caffeine_token
  [ "$output" = "∞" ]
}

@test "token is the human remaining time for a timed deadline" {
  future=$(($(date +%s) + 3600))
  pidfile 123 "$future"
  lib caffeine_token
  [[ "$output" =~ ^[0-9]+[smhd]$ ]]
}

# --- colour + glyph vocabulary ---------------------------------------------

@test "ON maps to catppuccin peach" {
  lib 'caffeine_state_colour ON'
  [ "$output" = "fab387" ]
}

@test "glyph is the single-width sun" {
  lib 'caffeine_state_glyph ON'
  [ "$output" = "☼" ]
}

@test "glyph honours a CAFFEINE_GLYPH override" {
  CAFFEINE_GLYPH="◉" lib 'caffeine_state_glyph ON'
  [ "$output" = "◉" ]
}

# --- human age formatter ----------------------------------------------------

@test "human age renders seconds, minutes, hours and days" {
  lib 'caffeine_human_age 5'
  [ "$output" = "5s" ]
  lib 'caffeine_human_age 125'
  [ "$output" = "2m" ]
  lib 'caffeine_human_age 7200'
  [ "$output" = "2h" ]
  lib 'caffeine_human_age 172800'
  [ "$output" = "2d" ]
}

@test "ON-LID maps to catppuccin maroon" {
  lib 'caffeine_state_colour ON-LID'
  [ "$output" = "eba0ac" ]
}

@test "ON-LID glyph is the eight-pointed star" {
  lib 'caffeine_state_glyph ON-LID'
  [ "$output" = "✷" ]
}

@test "lid glyph honours a CAFFEINE_LID_GLYPH override" {
  CAFFEINE_LID_GLYPH="◈" lib 'caffeine_state_glyph ON-LID'
  [ "$output" = "◈" ]
}

@test "the lid override does not leak into the idle glyph" {
  CAFFEINE_LID_GLYPH="◈" lib 'caffeine_state_glyph ON'
  [ "$output" = "☼" ]
}

# --- the real kernel flag ---------------------------------------------------

@test "sleep_disabled is true when pmset reports SleepDisabled 1" {
  stub_pmset 1
  lib caffeine_sleep_disabled
  [ "$status" -eq 0 ]
}

@test "sleep_disabled is false when pmset reports SleepDisabled 0" {
  stub_pmset 0
  lib caffeine_sleep_disabled
  [ "$status" -ne 0 ]
}

@test "sleep_disabled is false when pmset omits the key entirely" {
  # The ordinary case: pmset prints no SleepDisabled line at all when clear.
  stub_pmset absent
  lib caffeine_sleep_disabled
  [ "$status" -ne 0 ]
}

@test "sleep_disabled is false where there is no pmset at all" {
  # Linux, and any sanitised PATH: the flag cannot be raised, so it is not.
  run bash -c "source '$CALF_LIB'; PATH=/nonexistent caffeine_sleep_disabled"
  [ "$status" -ne 0 ]
}

# --- drive layer: the constraints, not the privileged path ------------------
# Starting a real lid session needs sudo and mutates a machine-wide kernel flag,
# so the happy path stays a manual smoke test (see ../../tmux/AGENTS.md). What is
# asserted here is what a caller can rely on without ever reaching sudo.

@test "lid mode refuses an indefinite session" {
  # No indefinite variant exists: an indefinite lid session is the exact
  # artefact the subsystem exists to prevent.
  lib 'caffeine_start_lid 0'
  [ "$status" -eq 2 ]
  lib 'caffeine_start_lid'
  [ "$status" -eq 2 ]
  [ ! -f "$CAFFEINE_PIDFILE" ]
}

@test "lid mode refuses a non-numeric duration" {
  lib 'caffeine_start_lid abc'
  [ "$status" -eq 2 ]
  [ ! -f "$CAFFEINE_PIDFILE" ]
}

@test "lid mode refuses a host with no pmset" {
  run bash -c "source '$CALF_LIB'; PATH=/nonexistent caffeine_start_lid 1800"
  [ "$status" -eq 3 ]
  [ ! -f "$CAFFEINE_PIDFILE" ]
}

@test "start records idle as the mode" {
  write_stub caffeinate <<'EOF'
#!/usr/bin/env bash
exec sleep 100
EOF
  lib 'caffeine_start 600'
  [ "$status" -eq 0 ]
  read -r _pid _deadline _mode <"$CAFFEINE_PIDFILE"
  [ "$_mode" = "idle" ]
  [ "$_deadline" -gt 0 ]
  kill "$_pid" 2>/dev/null || true
}

@test "stop waits for the managed pid to actually die" {
  # Load-bearing: caffeine_start* stops first, and without the wait an outgoing
  # lid supervisor's trap can fire after the incoming one raised the flag,
  # silently disarming a session the pill reports as ON-LID.
  sleep 100 &
  pid=$!
  pidfile3 "$pid" 0 lid
  lib caffeine_stop
  [ "$status" -eq 0 ]
  # The pid is gone by the time stop returned, not merely signalled.
  run kill -0 "$pid"
  [ "$status" -ne 0 ]
  [ ! -f "$CAFFEINE_PIDFILE" ]
}

@test "stop is a no-op with no pidfile" {
  lib caffeine_stop
  [ "$status" -eq 0 ]
  [ ! -f "$CAFFEINE_PIDFILE" ]
}
