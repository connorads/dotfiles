#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

AGENT="$FUNCTIONS_DIR/agents/agent"
CLI_LIB="$TESTS_DIR/../../tmux/scripts/agent-cli-lib.sh"
STATE_LIB="$TESTS_DIR/../../tmux/scripts/agent-state-lib.sh"
STATE_SH="$TESTS_DIR/../../tmux/scripts/agent-state.sh"
SWEEP="$TESTS_DIR/../../tmux/scripts/agent-sweep.sh"
SHELLS=" zsh bash sh fish dash ash "

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
  export AGENT_STATE_SH="$STATE_SH"
  # The name tests set the pane state out-of-band on bare shell panes; the
  # real sweep would clear it (shell foreground = agent dead), so the pre-name
  # sweep is disabled by default and enabled per-test where the death-clear is
  # the behaviour under test.
  export AGENT_SWEEP=/nonexistent
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

# --- agent wait ---

@test "agent wait returns 0 immediately when the state already matches" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state idle
  run_zsh_function "$AGENT" wait "$p1" # default --for done,idle,blocked
  [ "$status" -eq 0 ]
}

@test "agent wait matches an explicit --for state" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state blocked
  run env AGENT_WAIT_POLL=0.2 zsh --no-rcs "$AGENT" wait "$p1" --for blocked --timeout 5
  [ "$status" -eq 0 ]
}

@test "agent wait times out with exit 1" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state idle
  run env AGENT_WAIT_POLL=0.2 zsh --no-rcs "$AGENT" wait "$p1" --for working --timeout 1
  [ "$status" -eq 1 ]
  [[ "$output" == *timeout* ]]
}

@test "agent wait exits 3 when the pane dies mid-wait" {
  tx split-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state working
  (
    sleep 0.6
    tx kill-pane -t "$p2"
  ) &
  run env AGENT_WAIT_POLL=0.2 zsh --no-rcs "$AGENT" wait "$p2" --for done --timeout 10
  [ "$status" -eq 3 ]
  [[ "$output" == *"pane gone"* ]]
}

@test "agent wait rejects a bad --for token with exit 2" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  run_zsh_function "$AGENT" wait "$p1" --for bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"invalid state"* ]]
}

@test "agent wait without a target exits 2" {
  run_zsh_function "$AGENT" wait
  [ "$status" -eq 2 ]
}

# --- agent prompt (PATH tmux stub: send mechanics without a live agent) ---
#
# The stub logs every tmux call to $TEST_LOG and serves scripted reads:
# @agent_state pops lines from $AGENT_STATE_SEQ (last line repeats), pane_id
# echoes the -t argument (resolve succeeds), @agent_kind echoes
# $AGENT_STUB_KIND, load-buffer captures stdin to $AGENT_STUB_BUFFER.

write_tmux_stub() {
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
echo "tmux $*" >>"$TEST_LOG"
case "$*" in
  *'#{pane_id}'*)
    prev=
    for a in "$@"; do
      [ "$prev" = -t ] && { echo "$a"; break; }
      prev=$a
    done
    ;;
  *'#{@agent_state}'*)
    if [ -n "${AGENT_STATE_SEQ:-}" ] && [ -s "$AGENT_STATE_SEQ" ]; then
      head -n1 "$AGENT_STATE_SEQ"
      if [ "$(wc -l <"$AGENT_STATE_SEQ")" -gt 1 ]; then
        tail -n +2 "$AGENT_STATE_SEQ" >"$AGENT_STATE_SEQ.tmp"
        mv "$AGENT_STATE_SEQ.tmp" "$AGENT_STATE_SEQ"
      fi
    fi
    ;;
  *'#{@agent_kind}'*)
    echo "${AGENT_STUB_KIND:-claude}"
    ;;
  'load-buffer'*)
    cat >"${AGENT_STUB_BUFFER:-/dev/null}"
    ;;
esac
exit 0
EOF
}

# prompt_env — common fast-poll env for the prompt tests.
run_prompt() {
  run env AGENT_PROMPT_SETTLE=0 AGENT_PROMPT_VERIFY_POLL=0.05 \
    AGENT_PROMPT_VERIFY_TIMEOUT=0.2 zsh --no-rcs "$AGENT" prompt "$@"
}

@test "agent prompt buffer-pastes then submits with a separate Enter" {
  setup_test_home
  write_tmux_stub
  printf 'idle\nworking\n' >"$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STUB_BUFFER="$BATS_TEST_TMPDIR/buffer"
  run_prompt %1 hello world
  [ "$status" -eq 0 ]
  [ "$(cat "$AGENT_STUB_BUFFER")" = "hello world" ]
  grep -q 'tmux load-buffer -b agent-input -' "$TEST_LOG"
  grep -q 'tmux paste-buffer -d -p -b agent-input -t %1' "$TEST_LOG"
  grep -q 'tmux send-keys -t %1 C-m' "$TEST_LOG"
  # Load < paste < submit, and the body never goes through send-keys -l.
  load=$(grep -n 'load-buffer' "$TEST_LOG" | cut -d: -f1)
  paste=$(grep -n 'paste-buffer' "$TEST_LOG" | cut -d: -f1)
  submit=$(grep -n 'send-keys' "$TEST_LOG" | head -n1 | cut -d: -f1)
  [ "$load" -lt "$paste" ]
  [ "$paste" -lt "$submit" ]
  ! grep -q 'send-keys.*-l' "$TEST_LOG"
}

@test "agent prompt sends a multi-line body as one buffer paste" {
  setup_test_home
  write_tmux_stub
  printf 'idle\nworking\n' >"$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STUB_BUFFER="$BATS_TEST_TMPDIR/buffer"
  run_prompt %1 "$(printf 'line1\nline2')"
  [ "$status" -eq 0 ]
  [ "$(cat "$AGENT_STUB_BUFFER")" = "$(printf 'line1\nline2')" ]
  [ "$(grep -c 'load-buffer' "$TEST_LOG")" = 1 ]
  [ "$(grep -c 'paste-buffer' "$TEST_LOG")" = 1 ]
}

@test "agent prompt refuses a blocked pane with exit 4 and sends nothing" {
  setup_test_home
  write_tmux_stub
  printf 'blocked\n' >"$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  run_prompt %1 hello
  [ "$status" -eq 4 ]
  [[ "$output" == *blocked* ]]
  ! grep -q 'load-buffer\|paste-buffer\|send-keys' "$TEST_LOG"
}

@test "agent prompt refuses a working pane with exit 4" {
  setup_test_home
  write_tmux_stub
  printf 'working\n' >"$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  run_prompt %1 hello
  [ "$status" -eq 4 ]
  [[ "$output" == *working* ]]
  ! grep -q 'send-keys' "$TEST_LOG"
}

@test "agent prompt --force overrides the blocked gate" {
  setup_test_home
  write_tmux_stub
  printf 'blocked\nworking\n' >"$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  run_prompt %1 hello --force
  [ "$status" -eq 0 ]
  grep -q 'paste-buffer' "$TEST_LOG"
}

@test "agent prompt retries the submit key once then stalls with exit 5" {
  setup_test_home
  write_tmux_stub
  printf 'idle\n' >"$BATS_TEST_TMPDIR/stateseq" # never transitions
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  run_prompt %1 hello
  [ "$status" -eq 5 ]
  [[ "$output" == *stall* ]]
  [ "$(grep -c 'send-keys -t %1 C-m' "$TEST_LOG")" = 2 ]
}

@test "agent prompt skips the verify for kinds outside the allowlist" {
  setup_test_home
  write_tmux_stub
  printf 'idle\n' >"$BATS_TEST_TMPDIR/stateseq" # never transitions
  export AGENT_STATE_SEQ="$BATS_TEST_TMPDIR/stateseq"
  export AGENT_STUB_KIND=opencode
  run_prompt %1 hello
  [ "$status" -eq 0 ]
  # Only the gate read state; no verify polling happened.
  [ "$(grep -c '@agent_state' "$TEST_LOG")" = 1 ]
  [ "$(grep -c 'send-keys -t %1 C-m' "$TEST_LOG")" = 1 ]
}

@test "agent prompt without text exits 2" {
  run_zsh_function "$AGENT" prompt %1
  [ "$status" -eq 2 ]
}

# --- agent name / unname ---

# Wait until a pane's foreground is no longer a bare shell (the respawned child
# owns it) — mirrors agent-sweep.bats; callers skip on timeout.
wait_nonshell() {
  local pane=$1 cmd i
  for i in $(seq 1 30); do
    cmd=$(tx display-message -p -t "$pane" '#{pane_current_command}')
    case "$SHELLS" in *" $cmd "*) sleep 0.2 ;; *) return 0 ;; esac
  done
  return 1
}

@test "agent name labels the current pane via TMUX_PANE" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  run env TMUX_PANE="$p1" zsh --no-rcs "$AGENT" name backend
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p1" @agent_name)" = backend ]
}

@test "agent name labels an explicit target pane" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  run_zsh_function "$AGENT" name "$p1" backend
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p1" @agent_name)" = backend ]
}

@test "agent name rejects a duplicate live name" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_name backend
  tx split-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p2" @agent_state working
  run_zsh_function "$AGENT" name "$p2" backend
  [ "$status" -eq 2 ]
  [[ "$output" == *"already held"* ]]
  [ -z "$(tx show-options -pqv -t "$p2" @agent_name)" ]
}

@test "agent name re-applies a pane's own name without a self-collision" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_name backend
  run_zsh_function "$AGENT" name "$p1" backend
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p1" @agent_name)" = backend ]
}

@test "agent name frees a dead pane's name via the pre-sweep" {
  p1=$(tx display-message -p -t s '#{pane_id}') # bare shell = dead agent
  tx set-option -p -t "$p1" @agent_state done
  tx set-option -p -t "$p1" @agent_name backend
  tx split-window -t s
  p2=$(tx display-message -p -t s '#{pane_id}')
  tx respawn-pane -k -t "$p2" 'sh -c "exec sleep 300"' # live agent stand-in
  wait_nonshell "$p2" || skip "pane shell did not yield the foreground in time"
  tx set-option -p -t "$p2" @agent_state working
  run env AGENT_SWEEP="$SWEEP" zsh --no-rcs "$AGENT" name "$p2" backend
  [ "$status" -eq 0 ]
  [ "$(tx show-options -pqv -t "$p2" @agent_name)" = backend ]
  [ -z "$(tx show-options -pqv -t "$p1" @agent_name)" ]
}

@test "agent name rejects an invalid label before mutating" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  run_zsh_function "$AGENT" name "$p1" Backend
  [ "$status" -eq 2 ]
  [[ "$output" == *"invalid name"* ]]
  [ -z "$(tx show-options -pqv -t "$p1" @agent_name)" ]
}

@test "agent name on a stateless pane surfaces the mutator's refusal" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  run_zsh_function "$AGENT" name "$p1" backend
  [ "$status" -eq 2 ]
  [ -z "$(tx show-options -pqv -t "$p1" @agent_name)" ]
}

@test "agent unname clears the label" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_name backend
  run_zsh_function "$AGENT" unname "$p1"
  [ "$status" -eq 0 ]
  [ -z "$(tx show-options -pqv -t "$p1" @agent_name)" ]
}

@test "agent name outside tmux without a target exits 3" {
  run env -u TMUX_PANE zsh --no-rcs "$AGENT" name backend
  [ "$status" -eq 3 ]
}

@test "a name target resolves through @agent_name (agent state backend)" {
  p1=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$p1" @agent_state working
  tx set-option -p -t "$p1" @agent_name backend
  run_zsh_function "$AGENT" state backend
  [ "$status" -eq 0 ]
  [ "$output" = working ]
}

# --- agent pick ---

@test "agent pick requires fzf" {
  # Minimal PATH: fzf lives in the nix/brew dir, not /usr/bin or /bin (zsh is
  # invoked by absolute path so it needs no PATH entry).
  run env PATH=/usr/bin:/bin "$(command -v zsh)" --no-rcs "$AGENT" pick
  [ "$status" -eq 1 ]
  [[ "$output" == *"fzf required"* ]]
}

@test "agent pick delegates to the popup's pick (no-agents notice path)" {
  command -v fzf >/dev/null 2>&1 || skip "fzf not installed"
  # Empty private server → pick()'s pre-fzf notice proves the delegation.
  run_zsh_function "$AGENT" pick
  [ "$status" -eq 0 ]
  [[ "$output" == *"No active agents"* ]]
}

@test "agent rejects an unknown subcommand with exit 2" {
  run_zsh_function "$AGENT" frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown subcommand"* ]]
}
