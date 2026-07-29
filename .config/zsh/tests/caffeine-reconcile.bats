#!/usr/bin/env bats
#
# The backstop half of lid mode: clear the SleepDisabled kernel flag whenever it
# is raised with no live lid session behind it.
#
# Neither pmset nor sudo is real here. Both are PATH stubs over a flag *file*
# standing in for the kernel flag, so the branches can be driven — including the
# two failure shapes (refused, and returns 0 without taking) that are impossible
# to provoke on a real machine. Liveness is a real process, as elsewhere in this
# subsystem.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it.
RECONCILE="$HOME/.config/tmux/scripts/caffeine-reconcile.sh"

setup() {
  setup_test_home
  export CAFFEINE_PIDFILE="$HOME/.cache/tmux-caffeinate.pid"
  export CAFFEINE_RECONCILE_LOG="$HOME/.cache/tmux-caffeine-reconcile.log"
  export STUB_FLAG="$HOME/.cache/sleep-disabled"
  export STUB_SUDO_LOG="$HOME/.cache/sudo.log"
  mkdir -p "$HOME/.cache"
  : >"$STUB_SUDO_LOG"
  stub_pmset
  stub_sudo ok
  # No tmux here: the nag targets attached clients of the real server, which a
  # test must never touch. A stub that lists none keeps that path exercised but
  # inert.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
}

# The kernel flag stands in as a file. pmset -g prints the SleepDisabled line
# only when it is set, exactly as the real one does.
stub_pmset() {
  write_stub pmset <<'EOF'
#!/usr/bin/env bash
[ "$1" = "-g" ] || exit 0
printf 'System-wide power settings:\nCurrently in use:\n sleep 1\n'
[ "$(cat "$STUB_FLAG" 2>/dev/null)" = "1" ] && printf ' SleepDisabled 1\n'
exit 0
EOF
}

# stub_sudo MODE — ok: clears the flag. refused: exits 1 with sudo's own message.
# ineffective: exits 0 but leaves the flag up, the does-not-stick failure.
stub_sudo() {
  case "$1" in
  ok)
    write_stub sudo <<'EOF'
#!/usr/bin/env bash
[ "$1" = "-n" ] && shift
printf '%s\n' "$*" >>"$STUB_SUDO_LOG"
case "$*" in
*"disablesleep 0") echo 0 >"$STUB_FLAG" ;;
*"disablesleep 1") echo 1 >"$STUB_FLAG" ;;
esac
exit 0
EOF
    ;;
  refused)
    write_stub sudo <<'EOF'
#!/usr/bin/env bash
echo "sudo: a password is required" >&2
exit 1
EOF
    ;;
  ineffective)
    write_stub sudo <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_SUDO_LOG"
exit 0
EOF
    ;;
  esac
}

flag_set() { echo 1 >"$STUB_FLAG"; }
flag_clear() { echo 0 >"$STUB_FLAG"; }

# live_lid_pidfile — a real live process recorded as a lid session.
live_lid_pidfile() {
  sleep 100 &
  LIVE_PID=$!
  printf '%s %s lid\n' "$LIVE_PID" "$(($(date +%s) + 600))" >"$CAFFEINE_PIDFILE"
}

teardown() {
  [ -n "${LIVE_PID:-}" ] && kill "$LIVE_PID" 2>/dev/null
  return 0
}

# --- the cheap common case --------------------------------------------------

@test "does nothing when the flag is clear" {
  # This runs every 5 minutes forever, so the no-op path must stay silent.
  flag_clear
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ ! -s "$CAFFEINE_RECONCILE_LOG" ]
  [ ! -s "$STUB_SUDO_LOG" ]
}

@test "does nothing when pmset cannot be read" {
  # A detective control must not act on garbage: an erroring or unavailable
  # pmset (Linux, a sanitised PATH, a broken install) reads as flag-clear, so
  # nothing is cleared and no alarm is raised on no evidence.
  write_stub pmset <<'EOF'
#!/usr/bin/env bash
echo "pmset: broken" >&2
exit 1
EOF
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ ! -s "$CAFFEINE_RECONCILE_LOG" ]
  [ ! -s "$STUB_SUDO_LOG" ]
}

# --- the normal lid session -------------------------------------------------

@test "leaves the flag alone while a lid session is live" {
  # The session owns the flag until its own deadline; touching it here would
  # silently disarm a session the pill is reporting as ON-LID.
  flag_set
  live_lid_pidfile
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ "$(cat "$STUB_FLAG")" = "1" ]
  [ ! -s "$STUB_SUDO_LOG" ]
  [ ! -s "$CAFFEINE_RECONCILE_LOG" ]
}

# --- the cases no trap can cover --------------------------------------------

@test "clears a flag left behind by a killed supervisor" {
  # SIGKILL, crash, panic: the pidfile still says lid, but the pid is gone.
  flag_set
  sleep 100 &
  dead=$!
  kill -9 "$dead" 2>/dev/null || true
  wait "$dead" 2>/dev/null || true
  printf '%s %s lid\n' "$dead" "$(($(date +%s) + 600))" >"$CAFFEINE_PIDFILE"
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ "$(cat "$STUB_FLAG")" = "0" ]
  grep -q "cleared stray SleepDisabled" "$CAFFEINE_RECONCILE_LOG"
}

@test "clears a flag that survived a reboot, with no pidfile at all" {
  # RunAtLoad's case: the flag persists, the pidfile does not.
  flag_set
  rm -f "$CAFFEINE_PIDFILE"
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ "$(cat "$STUB_FLAG")" = "0" ]
  grep -q "cleared stray SleepDisabled" "$CAFFEINE_RECONCILE_LOG"
}

@test "clears a flag left raised while an ordinary idle session runs" {
  # ON is not ON-LID: an idle keep-awake never owns the kernel flag, so a flag
  # set alongside one is still stray.
  flag_set
  sleep 100 &
  LIVE_PID=$!
  printf '%s 0 idle\n' "$LIVE_PID" >"$CAFFEINE_PIDFILE"
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  [ "$(cat "$STUB_FLAG")" = "0" ]
}

# --- failure is logged, never swallowed -------------------------------------

@test "logs a refused clear with sudo's own stderr" {
  # The opposite of >/dev/null: a detective control that fails silently is the
  # bug this subsystem exists to avoid.
  flag_set
  stub_sudo refused
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  grep -q "CLEAR FAILED rc=1" "$CAFFEINE_RECONCILE_LOG"
  grep -q "a password is required" "$CAFFEINE_RECONCILE_LOG"
  [ "$(cat "$STUB_FLAG")" = "1" ]
}

@test "logs a clear that returns 0 without taking" {
  # The does-not-stick failure, seen from the other end to caffeine_start_lid's
  # readback: pmset is happy, the flag is still up, and saying so is the point.
  flag_set
  stub_sudo ineffective
  run "$RECONCILE"
  [ "$status" -eq 0 ]
  grep -q "CLEAR INEFFECTIVE" "$CAFFEINE_RECONCILE_LOG"
  [ "$(cat "$STUB_FLAG")" = "1" ]
}

@test "a failure to clear never fails the run" {
  # launchd retries on its own schedule; a non-zero exit would only add noise.
  flag_set
  stub_sudo refused
  run "$RECONCILE"
  [ "$status" -eq 0 ]
}
