#!/usr/bin/env bats
load test_helper

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/bb"
  export BB_CLI="$TEST_BIN/bb"
  export PLUGIN_STATE="$HOME/state.json" PLUGIN_WRITES="$HOME/writes" CONFIG_STATE="$HOME/config-state.json"
  printf '%s\n' '{"workflows":true}' >"$HOME/.config/bb/plugins.json"
  printf '%s\n' '{}' >"$HOME/.config/bb/plugin-config.json"
  printf '%s\n' '{"plugins":[{"id":"workflows","enabled":false},{"id":"other","enabled":true}]}' >"$PLUGIN_STATE"
  printf '%s\n' '{"other":{"schema":{"memoryEnabled":{"type":"boolean"},"name":{"type":"string"}},"values":{"memoryEnabled":true,"name":"a"}}}' >"$CONFIG_STATE"
  touch "$PLUGIN_WRITES"
  cat >"$BB_CLI" <<'STUB'
#!/usr/bin/env zsh
if [[ $2 == list ]]; then
  cat "$PLUGIN_STATE"
elif [[ $2 == config && $4 == --json ]]; then
  jq -e --arg id "$3" '.[$id] // error("unknown plugin") | {ok: true} + .' "$CONFIG_STATE"
elif [[ $2 == config && $4 == set ]]; then
  print -r -- "config $3 $5 $6" >> "$PLUGIN_WRITES"
  [[ ${FAIL_PLUGIN:-} != "$3" ]] || exit 1
  [[ ${IGNORE_WRITE:-} != 1 ]] || exit 0
  jq --arg id "$3" --arg key "$5" --arg value "$6" '.[$id].values[$key] = (if .[$id].schema[$key].type == "string" then $value else ($value | fromjson) end)' "$CONFIG_STATE" > "$CONFIG_STATE.next"
  mv "$CONFIG_STATE.next" "$CONFIG_STATE"
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

@test "check reports setting drift without changing settings" {
  printf '%s\n' '{}' >"$HOME/.config/bb/plugins.json"
  printf '%s\n' '{"other":{"memoryEnabled":false}}' >"$HOME/.config/bb/plugin-config.json"
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" check
  [ "$status" -eq 1 ]
  [[ "$output" == *"set other memoryEnabled=false"* ]]
  [ ! -s "$PLUGIN_WRITES" ]
}

@test "apply changes only differing settings and a repeat performs no writes" {
  printf '%s\n' '{"other":{"memoryEnabled":false,"name":"a"}}' >"$HOME/.config/bb/plugin-config.json"
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -eq 0 ]
  [ "$(cat "$PLUGIN_WRITES")" = $'enable workflows\nconfig other memoryEnabled false' ]
  [ "$(jq '.other.values.memoryEnabled' "$CONFIG_STATE")" = false ]
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" check
  [ "$status" -eq 0 ]
  [ "$(wc -l <"$PLUGIN_WRITES" | tr -d ' ')" = 2 ]
}

@test "invalid settings, unknown keys and unknown plugins fail before any writes" {
  for config in '[]' '{"other":true}' '{"other":{"memoryEnabled":null}}' '{"other":{"missing":true}}' '{"missing":{"memoryEnabled":false}}'; do
    printf '%s\n' "$config" >"$HOME/.config/bb/plugin-config.json"
    run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
    [ "$status" -ne 0 ]
    [ ! -s "$PLUGIN_WRITES" ]
  done
}

@test "read-back detects a setting command that did not change state" {
  printf '%s\n' '{}' >"$HOME/.config/bb/plugins.json"
  printf '%s\n' '{"other":{"memoryEnabled":false}}' >"$HOME/.config/bb/plugin-config.json"
  export IGNORE_WRITE=1
  run zsh "$FUNCTIONS_DIR/agents/bb-plugins" apply
  [ "$status" -ne 0 ]
  [[ "$output" == *"Verification failed"* ]]
}
