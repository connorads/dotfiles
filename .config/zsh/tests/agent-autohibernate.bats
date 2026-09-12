#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

SCRIPT="$TESTS_DIR/../../tmux/scripts/agent-autohibernate.sh"
CONF="$HOME/.config/tmux/tmux.conf"
tx() { "$TMUX_BIN" -L "$SOCK" "$@"; }

setup() {
  setup_test_home
  TMUX_BIN="$(command -v tmux || true)"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  SOCK="agentauto_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  TMUX="$(tx display-message -p -t s '#{socket_path}'),$(tx display-message -p -t s '#{pid}'),0"
  export TMUX
  export AGENT_AUTO_STATE_DIR="$BATS_TEST_TMPDIR/auto"
  export AGENT_AUTO_ENGINE="$BATS_TEST_TMPDIR/engine"
  export AGENT_AUTO_ENGINE_LOG="$BATS_TEST_TMPDIR/engine.log"
  export AGENT_AUTO_MEMORY_STATE=CRITICAL
  export AGENT_AUTO_MIN_IDLE=10
  export AGENT_AUTO_COOLDOWN=0
  export AGENT_AUTO_CRITICAL_SAMPLES=3
  export AGENT_AUTO_EPISODE_CAP=2
  export AGENT_AUTO_RESET_AFTER=30
  write_executable "$AGENT_AUTO_ENGINE" <<'EOF'
#!/usr/bin/env bash
case "$1" in
probe)
  pane=$2
  kind=$(tmux show-options -pqv -t "$pane" @agent_kind)
  sid=$(tmux show-options -pqv -t "$pane" @test_session_id)
  state=$(tmux show-options -pqv -t "$pane" @agent_state)
  idle=$(tmux show-options -pqv -t "$pane" @agent_idle_since)
  jq -n --arg pane "$pane" --arg kind "$kind" --arg sid "$sid" --arg state "$state" --arg idle "$idle" \
    '{pane:$pane,pid:123,kind:$kind,sessionId:$sid,state:$state,idleSince:$idle}'
  ;;
hibernate)
  printf '%s\t%s\n' "$*" "${AGENT_HIBERNATE_AUTO_EXPECTED:-}" >>"$AGENT_AUTO_ENGINE_LOG"
  ;;
esac
EOF
  pane=$(tx display-message -p -t s '#{pane_id}')
  tx set-option -p -t "$pane" @agent_state idle
  tx set-option -p -t "$pane" @agent_kind claude
  tx set-option -p -t "$pane" @agent_idle_since 100
  tx set-option -p -t "$pane" @test_session_id sid-one
}

teardown() {
  stop_private_server
}

@test "tracked mode defaults to observe" {
  grep -q '^set -g @agent_auto_hibernate observe$' "$CONF"
}

@test "pin is durable by conversation identity and unpin removes it" {
  run "$SCRIPT" pin "$pane"
  [ "$status" -eq 0 ]
  [ "$(jq -r '.["claude:sid-one"]' "$AGENT_AUTO_STATE_DIR/pins.json")" = true ]
  [ "$(tx show-options -pqv -t "$pane" @agent_hibernate_pinned)" = on ]

  run "$SCRIPT" unpin "$pane"
  [ "$status" -eq 0 ]
  [ "$(jq -r 'has("claude:sid-one")' "$AGENT_AUTO_STATE_DIR/pins.json")" = false ]
  [ -z "$(tx show-options -pqv -t "$pane" @agent_hibernate_pinned)" ]
}

@test "status names protected states and reports an eligible hidden pane" {
  run env AGENT_AUTO_NOW=200 "$SCRIPT" status --json
  [ "$status" -eq 0 ]
  [ "$(jq -r '.mode' <<<"$output")" = observe ]
  [ "$(jq -r '.pressure' <<<"$output")" = CRITICAL ]
  [ "$(jq -r '.panes[0].decision' <<<"$output")" = eligible ]

  tx set-option -p -t "$pane" @agent_state done
  run env AGENT_AUTO_NOW=200 "$SCRIPT" status --json
  [ "$(jq -r '.panes[0].decision' <<<"$output")" = state-done ]
}

@test "a durable pin excludes an otherwise eligible conversation" {
  "$SCRIPT" pin "$pane" >/dev/null
  run env AGENT_AUTO_NOW=200 "$SCRIPT" status --json
  [ "$status" -eq 0 ]
  [ "$(jq -r '.panes[0].decision' <<<"$output")" = pinned ]
}

@test "observe waits for sustained critical pressure and never hibernates" {
  run env AGENT_AUTO_NOW=200 "$SCRIPT" tick
  run env AGENT_AUTO_NOW=210 "$SCRIPT" tick
  [ ! -f "$AGENT_AUTO_ENGINE_LOG" ]
  run env AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ ! -f "$AGENT_AUTO_ENGINE_LOG" ]
  [ "$(jq -r '.outcome' "$AGENT_AUTO_STATE_DIR/events.jsonl")" = proposed ]
}

@test "on mode hibernates one oldest eligible pane after the pressure streak" {
  "$SCRIPT" mode on >/dev/null
  run env AGENT_AUTO_NOW=200 "$SCRIPT" tick
  run env AGENT_AUTO_NOW=210 "$SCRIPT" tick
  run env AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ "$status" -eq 0 ]
  [ "$(wc -l <"$AGENT_AUTO_ENGINE_LOG" | tr -d ' ')" = 1 ]
  grep -q '^hibernate .* --auto' "$AGENT_AUTO_ENGINE_LOG"
  [ "$(jq -r '.episodeActions' "$AGENT_AUTO_STATE_DIR/policy.json")" = 1 ]
}

@test "one critical episode is capped at two automatic actions" {
  "$SCRIPT" mode on >/dev/null
  run env AGENT_AUTO_CRITICAL_SAMPLES=1 AGENT_AUTO_SUSTAINED_FOR=0 AGENT_AUTO_NOW=200 "$SCRIPT" tick
  run env AGENT_AUTO_CRITICAL_SAMPLES=1 AGENT_AUTO_SUSTAINED_FOR=0 AGENT_AUTO_NOW=210 "$SCRIPT" tick
  run env AGENT_AUTO_CRITICAL_SAMPLES=1 AGENT_AUTO_SUSTAINED_FOR=0 AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ "$(wc -l <"$AGENT_AUTO_ENGINE_LOG" | tr -d ' ')" = 2 ]
  [ "$(jq -r '.episodeActions' "$AGENT_AUTO_STATE_DIR/policy.json")" = 2 ]
}

@test "missing pressure telemetry never acts" {
  "$SCRIPT" mode on >/dev/null
  run env AGENT_AUTO_MEMORY_STATE=OK AGENT_AUTO_NOW=200 "$SCRIPT" tick
  run env AGENT_AUTO_MEMORY_STATE=OK AGENT_AUTO_NOW=210 "$SCRIPT" tick
  run env AGENT_AUTO_MEMORY_STATE=OK AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ ! -f "$AGENT_AUTO_ENGINE_LOG" ]
}

@test "a malformed pin store fails closed" {
  mkdir -p "$AGENT_AUTO_STATE_DIR"
  printf '[]\n' >"$AGENT_AUTO_STATE_DIR/pins.json"
  "$SCRIPT" mode on >/dev/null
  run env AGENT_AUTO_NOW=200 "$SCRIPT" tick
  run env AGENT_AUTO_NOW=210 "$SCRIPT" tick
  run env AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ ! -f "$AGENT_AUTO_ENGINE_LOG" ]
  [ "$(jq -r '.reason' "$AGENT_AUTO_STATE_DIR/events.jsonl")" = malformed-pins ]
}

@test "a malformed policy file fails closed" {
  mkdir -p "$AGENT_AUTO_STATE_DIR"
  printf '{"criticalStreak":"three"}\n' >"$AGENT_AUTO_STATE_DIR/policy.json"
  "$SCRIPT" mode on >/dev/null
  run env AGENT_AUTO_NOW=220 "$SCRIPT" tick
  [ "$status" -eq 0 ]
  [ ! -f "$AGENT_AUTO_ENGINE_LOG" ]
  [ "$(jq -r '.reason' "$AGENT_AUTO_STATE_DIR/events.jsonl")" = malformed-policy ]
}
