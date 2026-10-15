#!/usr/bin/env bats
load test_helper

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/bb"
  export BB_CLI="$TEST_BIN/bb"
  export PLUGIN_STATE="$HOME/state.json" PLUGIN_WRITES="$HOME/writes"
  printf '%s\n' '{"workflows":true}' >"$HOME/.config/bb/plugins.json"
  printf '%s\n' '{"plugins":[{"id":"workflows","enabled":false},{"id":"other","enabled":true}]}' >"$PLUGIN_STATE"
  touch "$PLUGIN_WRITES"
  cat >"$BB_CLI" <<'STUB'
#!/usr/bin/env zsh
if [[ $2 == list ]]; then
  cat "$PLUGIN_STATE"
else
  print -r -- "$2 $3" >> "$PLUGIN_WRITES"
  [[ ${FAIL_PLUGIN:-} != "$3" ]] || exit 1
  [[ ${IGNORE_WRITE:-} != 1 ]] || exit 0
  jq --arg id "$3" --argjson enabled "$([[ $2 == enable ]] && echo true || echo false)" '.plugins |= map(if .id == $id then .enabled = $enabled else . end)' "$PLUGIN_STATE" > "$PLUGIN_STATE.next"
  mv "$PLUGIN_STATE.next" "$PLUGIN_STATE"
fi
STUB
  chmod +x "$BB_CLI"
}

@test "check reports drift without changing plugins" {
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" check
  [ "$status" -eq 1 ]
  [[ "$output" == *"enable workflows"* ]]
  [ ! -s "$PLUGIN_WRITES" ]
}

@test "apply changes only managed plugins and a repeat performs no writes" {
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -eq 0 ]
  [ "$(cat "$PLUGIN_WRITES")" = 'enable workflows' ]
  [ "$(jq '.plugins[] | select(.id == "other") | .enabled' "$PLUGIN_STATE")" = true ]
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -eq 0 ]
  [ "$(wc -l <"$PLUGIN_WRITES" | tr -d ' ')" = 1 ]
}

@test "invalid config and missing IDs fail before any writes" {
  for config in '{"workflows":"yes"}' '{"workflows":true,"missing":true}' '[]'; do
    printf '%s\n' "$config" >"$HOME/.config/bb/plugins.json"
    run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
    [ "$status" -ne 0 ]
    [ ! -s "$PLUGIN_WRITES" ]
  done
}

@test "apply reports partial failure and can finish on a later run" {
  printf '%s\n' '{"workflows":true,"other":false}' >"$HOME/.config/bb/plugins.json"
  export FAIL_PLUGIN=other
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -ne 0 ]
  [[ "$output" == *"Failed to disable other"* ]]
  [ "$(jq '.plugins[0].enabled' "$PLUGIN_STATE")" = true ]
  unset FAIL_PLUGIN
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -eq 0 ]
  [ "$(grep -c '^enable workflows$' "$PLUGIN_WRITES")" = 1 ]
}

@test "read-back detects a successful command that did not change state" {
  export IGNORE_WRITE=1
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -ne 0 ]
  [[ "$output" == *"Verification failed"* ]]
}

@test "removing an entry leaves its live state alone" {
  printf '%s\n' '{}' >"$HOME/.config/bb/plugins.json"
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -eq 0 ]
  [ ! -s "$PLUGIN_WRITES" ]
}
