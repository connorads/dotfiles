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

# Write "pid deadline" to the pidfile.
pidfile() {
  printf '%s %s\n' "$1" "$2" >"$CAFFEINE_PIDFILE"
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
