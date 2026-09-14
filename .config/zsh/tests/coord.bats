#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

COORD="$FUNCTIONS_DIR/agents/coord"
AGENT="$FUNCTIONS_DIR/agents/agent"
SCRIPTS="$TESTS_DIR/../../tmux/scripts"
CLI_LIB="$SCRIPTS/agent-cli-lib.sh"

# Throwaway private tmux server (-f /dev/null: bare, no real config). Started
# AFTER setup_test_home so the panes it spawns inherit the isolated PATH (the
# codex/claude stubs) and CODEX_ARGV_FILE. Bare `tmux` (as coord and the lib
# invoke it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  setup_test_home
  export CODEX_ARGV_FILE="$BATS_TEST_TMPDIR/codex.argv"
  export COORD_DIR="$TEST_HOME/coord"
  mkdir -p "$COORD_DIR" "$XDG_CONFIG_HOME/coord"
  cat >"$XDG_CONFIG_HOME/coord/config" <<'CFG'
COORD_KIND=codex
COORD_MODEL=gpt-5.6-sol
COORD_WINDOW=coord
COORD_FLAGS=--dangerously-bypass-approvals-and-sandbox
CFG
  write_stub codex <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CODEX_ARGV_FILE"
exec sleep 300
STUB
  SOCK="coord_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  export AGENT_SCRIPTS_DIR="$SCRIPTS"
  export AGENT_STATE_LIB="$SCRIPTS/agent-state-lib.sh"
  export AGENT_BIN="$AGENT"
  # No sweep: the stubs' foreground is a bare sleep, which the real sweep would
  # read as "agent dead" and clear any state a test sets by hand.
  export AGENT_SWEEP=/nonexistent
  export AGENT_WAIT_POLL=0.2
}

teardown() {
  stop_private_server
}

run_coord() {
  run zsh --no-rcs "$COORD" "$@"
}

active_pane() { tx display-message -p -t s '#{pane_id}'; }
coord_pane() {
  tx list-panes -a -F '#{window_name} #{pane_id}' | awk '$1 == "coord" { print $2; exit }'
}

# --- pure decision ------------------------------------------------------------

@test "coord_next_action: launch / goto / return / return-lost" {
  . "$CLI_LIB"
  [ "$(coord_next_action %1 "" 0)" = launch ]
  [ "$(coord_next_action %1 %2 0)" = goto ]
  [ "$(coord_next_action %1 %2 1)" = goto ]
  [ "$(coord_next_action %2 %2 1)" = return ]
  [ "$(coord_next_action %2 %2 0)" = return-lost ]
  [ "$(coord_next_action %2 %2 "")" = return-lost ]
}

# --- launch ---------------------------------------------------------------------

@test "launch: creates a window named coord in COORD_DIR, jumps to it, records the origin" {
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 0 ]
  new=$(coord_pane)
  [ -n "$new" ]
  [ "$new" != "$p1" ]
  [ "$(active_pane)" = "$new" ]
  # -P: macOS spells the tmp dir /var/... and tmux reports /private/var/...
  [ "$(tx display-message -p -t "$new" '#{pane_current_path}')" = "$(cd "$COORD_DIR" && pwd -P)" ]
  [ "$(tx show-options -pqv -t "$new" @coord_return)" = "$p1" ]
}

@test "launch: codex argv carries the model, the flags and the trust override" {
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 0 ]
  wait_until '[ -s "$CODEX_ARGV_FILE" ]'
  run cat "$CODEX_ARGV_FILE"
  [ "${lines[0]}" = -m ]
  [ "${lines[1]}" = gpt-5.6-sol ]
  [ "${lines[2]}" = --dangerously-bypass-approvals-and-sandbox ]
  [ "${lines[3]}" = -c ]
  [ "${lines[4]}" = "projects.\"$COORD_DIR\".trust_level=\"trusted\"" ]
}

@test "launch: an exported COORD_* wins over the config file" {
  p1=$(active_pane)
  run env COORD_MODEL=other-model COORD_FLAGS= zsh --no-rcs "$COORD" toggle "$p1"
  [ "$status" -eq 0 ]
  wait_until '[ -s "$CODEX_ARGV_FILE" ]'
  run cat "$CODEX_ARGV_FILE"
  [ "${lines[1]}" = other-model ]
  [ "${lines[2]}" = -c ]
}

@test "launch: claude kind takes the shared baseline flags then model and posture" {
  write_stub claude <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CODEX_ARGV_FILE"
exec sleep 300
STUB
  write_stub claude-launch-flags <<'STUB'
#!/usr/bin/env bash
echo "--append-system-prompt-file /x/append.md"
STUB
  p1=$(active_pane)
  run env COORD_KIND=claude COORD_FLAGS=--dangerously-skip-permissions \
    zsh --no-rcs "$COORD" toggle "$p1"
  [ "$status" -eq 0 ]
  wait_until '[ -s "$CODEX_ARGV_FILE" ]'
  [ "$(tr '\n' ' ' <"$CODEX_ARGV_FILE")" = "--append-system-prompt-file /x/append.md --model gpt-5.6-sol --dangerously-skip-permissions " ]
}

@test "launch: names the pane once its state appears, and never writes @agent_state itself" {
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 0 ]
  new=$(coord_pane)
  [ -z "$(tx show-options -pqv -t "$new" @agent_state)" ]
  [ -z "$(tx show-options -pqv -t "$new" @agent_name)" ]
  # The agent's own hooks would set this; stand in for them.
  tx set-option -p -t "$new" @agent_state idle
  wait_until -t 15 '[ "$(tx show-options -pqv -t "$new" @agent_name)" = coord ]'
  [ "$(tx show-options -pqv -t "$new" @agent_state)" = idle ]
}

@test "launch: an unknown COORD_KIND exits 2 and creates nothing" {
  p1=$(active_pane)
  run env COORD_KIND=opencode zsh --no-rcs "$COORD" toggle "$p1"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown COORD_KIND"* ]]
  [ -z "$(coord_pane)" ]
}

@test "launch: a missing COORD_DIR exits 2 and creates nothing" {
  p1=$(active_pane)
  run env COORD_DIR="$TEST_HOME/nowhere" zsh --no-rcs "$COORD" toggle "$p1"
  [ "$status" -eq 2 ]
  [[ "$output" == *"not a directory"* ]]
  [ -z "$(coord_pane)" ]
}

# --- toggle ---------------------------------------------------------------------

@test "toggle: from another pane jumps to the coord pane and re-records the origin" {
  p1=$(active_pane)
  run_coord toggle "$p1"
  new=$(coord_pane)
  tx new-window -t s
  p3=$(active_pane)
  [ "$p3" != "$new" ]
  run_coord toggle "$p3"
  [ "$status" -eq 0 ]
  [ "$(active_pane)" = "$new" ]
  [ "$(tx show-options -pqv -t "$new" @coord_return)" = "$p3" ]
}

@test "toggle: from inside coord returns to the origin and clears it" {
  p1=$(active_pane)
  run_coord toggle "$p1"
  new=$(coord_pane)
  [ "$(active_pane)" = "$new" ]
  run_coord toggle "$new"
  [ "$status" -eq 0 ]
  [ "$(active_pane)" = "$p1" ]
  [ -z "$(tx show-options -pqv -t "$new" @coord_return)" ]
}

@test "toggle: a dead origin stays in coord and says so" {
  tx new-window -t s
  p2=$(active_pane)
  run_coord toggle "$p2"
  new=$(coord_pane)
  tx kill-pane -t "$p2"
  run_coord toggle "$new"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no pane to return to"* ]]
  [ "$(active_pane)" = "$new" ]
  [ -z "$(tx show-options -pqv -t "$new" @coord_return)" ]
}

@test "toggle: a restored window (name kept, agent name lost) is found by window and renamed" {
  tx new-window -d -t s: -n coord 'sleep 300'
  restored=$(coord_pane)
  tx set-option -p -t "$restored" @agent_state idle
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 0 ]
  [ "$(active_pane)" = "$restored" ]
  [ "$(tx show-options -pqv -t "$restored" @agent_name)" = coord ]
  [ "$(tx list-windows -t s -F '#{window_name}' | grep -c '^coord$')" = 1 ]
}

@test "toggle: finds a restored window under pane-base-index 1, the live config's value" {
  tx set-option -g pane-base-index 1
  tx new-window -d -t s: -n coord 'sleep 300'
  restored=$(coord_pane)
  [ "$(tx display-message -p -t "$restored" '#{pane_index}')" = 1 ]
  p1=$(active_pane)
  run_coord status "$p1"
  [ "$output" = "coord=$restored found_by=window origin=none alive=0" ]
}

@test "toggle: resolves by agent name before window name" {
  tx new-window -d -t s: -n coord 'sleep 300'
  decoy=$(coord_pane)
  tx new-window -d -t s: -n other 'sleep 300'
  named=$(tx list-panes -a -F '#{window_name} #{pane_id}' | awk '$1 == "other" { print $2 }')
  tx set-option -p -t "$named" @agent_state idle
  tx set-option -p -t "$named" @agent_name coord
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 0 ]
  [ "$(active_pane)" = "$named" ]
  [ "$(active_pane)" != "$decoy" ]
}

# --- status / usage -------------------------------------------------------------

@test "status reports none before launch and the pane, finder and origin after" {
  p1=$(active_pane)
  run_coord status "$p1"
  [ "$status" -eq 0 ]
  [ "$output" = "coord=none found_by=none origin=none alive=0" ]
  run_coord toggle "$p1"
  new=$(coord_pane)
  run_coord status "$new"
  [ "$output" = "coord=$new found_by=window origin=$p1 alive=1" ]
}

@test "usage: unknown subcommand and missing pane exit 2" {
  run_coord frobnicate
  [ "$status" -eq 2 ]
  run env -u TMUX_PANE zsh --no-rcs "$COORD" toggle
  [ "$status" -eq 2 ]
  [[ "$output" == *"not inside tmux"* ]]
}

@test "config: an unset required key exits 2" {
  rm "$XDG_CONFIG_HOME/coord/config"
  p1=$(active_pane)
  run_coord toggle "$p1"
  [ "$status" -eq 2 ]
  [[ "$output" == *"COORD_KIND is unset"* ]]
}
