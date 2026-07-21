#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

AGENT="$FUNCTIONS_DIR/agents/agent"
CLI_LIB="$TESTS_DIR/../../tmux/scripts/agent-cli-lib.sh"
STATE_LIB="$TESTS_DIR/../../tmux/scripts/agent-state-lib.sh"

# Throwaway private tmux server (-f /dev/null: bare, no real config) — the CLI
# and the lib only read/write the @agent_* options they manage; the real
# config's focus hooks would mutate state mid-test. Bare `tmux` (as the lib
# invokes it) is pointed here via $TMUX.
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentcli_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  export AGENT_STATE_LIB="$STATE_LIB"
  export AGENT_CLI_LIB="$CLI_LIB"
}

teardown() {
  [ -n "${TMUX_BIN:-}" ] && [ -n "${SOCK:-}" ] && tx kill-server 2>/dev/null || true
}

# --- pure helpers (sourced; the lib's guard pulls in agent-state-lib.sh) ---

@test "agent_state_matches: member, non-member, empty never matches" {
  . "$CLI_LIB"
  agent_state_matches done "done,idle"
  agent_state_matches blocked "blocked"
  ! agent_state_matches working "done,idle"
  ! agent_state_matches "" "done,idle"
}

@test "agent_prompt_gate: blocked/working refuse unless forced; rest send" {
  . "$CLI_LIB"
  [ "$(agent_prompt_gate blocked 0)" = refuse-blocked ]
  [ "$(agent_prompt_gate blocked 1)" = send ]
  [ "$(agent_prompt_gate working 0)" = refuse-working ]
  [ "$(agent_prompt_gate working 1)" = send ]
  [ "$(agent_prompt_gate idle 0)" = send ]
  [ "$(agent_prompt_gate done 0)" = send ]
  [ "$(agent_prompt_gate "" 0)" = send ]
}

@test "agent_submit_key: C-m for every kind (the future per-kind seam)" {
  . "$CLI_LIB"
  [ "$(agent_submit_key claude)" = C-m ]
  [ "$(agent_submit_key codex)" = C-m ]
  [ "$(agent_submit_key "")" = C-m ]
}

# --- agent_resolve_target (real server) ---

@test "resolve: a valid pane id echoes its canonical id" {
  . "$CLI_LIB"
  p1=$(tx display-message -p -t s '#{pane_id}')
  [ "$(agent_resolve_target "$p1")" = "$p1" ]
}

@test "resolve: a nonexistent pane id returns 3" {
  . "$CLI_LIB"
  run -3 agent_resolve_target %999
  [[ "$output" == *"no such pane"* ]]
}

@test "resolve: a session:win.pane address resolves to the pane id" {
  . "$CLI_LIB"
  p1=$(tx display-message -p -t s '#{pane_id}')
  addr=$(tx display-message -p -t s '#{session_name}:#{window_index}.#{pane_index}')
  [ "$(agent_resolve_target "$addr")" = "$p1" ]
}

@test "resolve: an unknown agent name returns 3" {
  . "$CLI_LIB"
  run -3 agent_resolve_target nosuchagent
  [[ "$output" == *"no agent named"* ]]
}

@test "resolve: a missing target returns 2" {
  . "$CLI_LIB"
  run -2 agent_resolve_target ""
}

# --- agent_list_rows (real server) ---

@test "list_rows ranks states, excludes untracked panes, carries full cwd" {
  . "$CLI_LIB"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_kind claude
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state blocked
  tx set-option -p -t "$p2" @agent_name backend
  tx split-window -t s # untracked pane
  run agent_list_rows
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 2 ]
  [ "$(printf '%s\n' "$output" | head -n1 | cut -f1)" = "$p2" ] # blocked first
  [ "$(printf '%s\n' "$output" | head -n1 | cut -f4)" = backend ]
  [ "$(printf '%s\n' "$output" | sed -n 2p | cut -f1)" = "$p1" ]
  [ "$(printf '%s\n' "$output" | sed -n 2p | cut -f3)" = claude ]
  case "$(printf '%s\n' "$output" | head -n1 | cut -f7)" in
  /*) : ;; # full path, not a basename
  *) return 1 ;;
  esac
}

# --- agent ls / agent state (the CLI) ---

@test "agent ls lists tracked panes ranked, untracked excluded" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state idle
  tx new-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state blocked
  tx split-window -t s # untracked
  run_zsh_function "$AGENT" ls
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 2 ]
  first=$(printf '%s\n' "$output" | head -n1)
  [[ "$first" == "$p2"* ]]
  [[ "$first" == *blocked* ]]
}

@test "agent ls with no agents prints nothing and exits 0" {
  run_zsh_function "$AGENT" ls
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "agent ls --json emits pane/state/kind/name/cwd with empty fields null" {
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state blocked
  run_zsh_function "$AGENT" ls --json
  [ "$status" -eq 0 ]
  printf '%s' "$output" | jq -e --arg pane "$p1" '
    length == 1 and .[0].pane == $pane and .[0].state == "blocked"
    and .[0].kind == null and .[0].name == null
    and (.[0].cwd | startswith("/"))'
}

@test "agent ls --json with no agents emits []" {
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  run_zsh_function "$AGENT" ls --json
  [ "$status" -eq 0 ]
  printf '%s' "$output" | jq -e '. == []'
}

@test "agent ls rejects an unknown flag with exit 2" {
  run_zsh_function "$AGENT" ls --bogus
  [ "$status" -eq 2 ]
}

@test "agent state prints the bare state word" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  run_zsh_function "$AGENT" state "$p1"
  [ "$status" -eq 0 ]
  [ "$output" = working ]
}

@test "agent state on an untracked pane prints empty and exits 0" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  run_zsh_function "$AGENT" state "$p1"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "agent state on a missing pane exits 3" {
  run_zsh_function "$AGENT" state %999
  [ "$status" -eq 3 ]
}

@test "agent state without a target exits 2" {
  run_zsh_function "$AGENT" state
  [ "$status" -eq 2 ]
}

@test "agent rejects an unknown subcommand with exit 2" {
  run_zsh_function "$AGENT" frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown subcommand"* ]]
}
