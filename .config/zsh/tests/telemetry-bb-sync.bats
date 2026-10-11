#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
source "$BATS_TEST_DIRNAME/test_helper.bash"

setup() {
  setup_test_home
  export XDG_CONFIG_HOME="$HOME/.config"
  mkdir -p "$XDG_CONFIG_HOME/telemetry"
  export BB_CLI="$TEST_BIN/bb"
  export SYNC_LOG="$HOME/sync.log"
  write_stub mise <<'EOF'
#!/usr/bin/env bash
[ "$1 $2 $3 $4" = "-C $HOME which node" ] || exit 2
printf '/usr/bin/node\n'
EOF
  write_stub bb <<'EOF'
#!/usr/bin/env bash
[ "$1 $2 $3" = 'machine env set' ] || exit 2
value=$(cat)
printf '%s=%s\n' "$4" "$value" >>"$SYNC_LOG"
[ "$4" != "${FAIL_NAME:-}" ]
EOF
}

@test "sync sets declared values through stdin without touching other BB variables" {
  printf '%s\n' '{"DO_NOT_TRACK":"1","BB_TELEMETRY":"false"}' >"$XDG_CONFIG_HOME/telemetry/environment.json"
  run_zsh_function "$FUNCTIONS_DIR/agents/telemetry-bb-sync"
  [ "$status" -eq 0 ]
  [ "$(cat "$SYNC_LOG")" = $'BB_TELEMETRY=false\nDO_NOT_TRACK=1' ]
}

@test "sync stops on a rejected variable and reports failure" {
  printf '%s\n' '{"A":"1","B":"false"}' >"$XDG_CONFIG_HOME/telemetry/environment.json"
  export FAIL_NAME=A
  run_zsh_function "$FUNCTIONS_DIR/agents/telemetry-bb-sync"
  [ "$status" -ne 0 ]
  [ "$(cat "$SYNC_LOG")" = 'A=1' ]
}

@test "missing declaration fails before contacting BB" {
  run_zsh_function "$FUNCTIONS_DIR/agents/telemetry-bb-sync"
  [ "$status" -ne 0 ]
  [ ! -e "$SYNC_LOG" ]
  [[ "$output" == *"Missing "*"environment.json"* ]]
}

@test "non-interactive zsh loads telemetry defaults without zshrc" {
  cp "$ZSH_DIR/../../.zshenv" "$HOME/.zshenv"
  printf '%s\n' 'export DO_NOT_TRACK=1' >"$XDG_CONFIG_HOME/telemetry/environment.sh"
  run env -u DO_NOT_TRACK ZDOTDIR="$HOME" zsh -c 'print -r -- "$DO_NOT_TRACK"'
  [ "$status" -eq 0 ]
  [ "$output" = '1' ]
}
