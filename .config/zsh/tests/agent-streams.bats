#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

CXYS="$FUNCTIONS_DIR/agents/cxys"
OCYS="$FUNCTIONS_DIR/agents/ocys"

setup() {
  setup_test_home

  write_stub codex <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"item.started","item":{"type":"command_execution","command":"rg foo ."}}
{"type":"item.completed","item":{"type":"command_execution","command":"rg foo .","exit_code":0}}
{"type":"item.started","item":{"type":"command_execution","command":"apply_patch fix"}}
{"type":"item.completed","item":{"type":"command_execution","command":"apply_patch fix","exit_code":1}}
{"type":"item.completed","item":{"type":"agent_message","text":"done"}}
{"type":"item.completed","item":{"type":"error","message":"bad news"}}
{"type":"turn.completed","usage":{"input_tokens":11,"cached_input_tokens":13,"output_tokens":17}}
JSON
EOS

  write_stub opencode <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"text","part":{"text":"hello"}}
{"type":"tool_use","part":{"tool":"read","state":{"status":"completed","input":{"filePath":"/tmp/AGENTS.md"}}}}
{"type":"tool_use","part":{"tool":"grep","state":{"status":"completed","input":{"pattern":"AGENTS.md","include":"**/*.md"}}}}
{"type":"tool_use","part":{"tool":"web_fetch","state":{"status":"completed","input":{"url":"https://example.com"}}}}
{"type":"tool_use","part":{"tool":"edit","state":{"status":"completed","input":{"command":"apply patch"}}}}
{"type":"tool_use","part":{"tool":"task","state":{"status":"completed","input":{"foo":"bar"}}}}
{"type":"step_finish","part":{"tokens":{"total":42},"cost":0.0098}}
JSON
EOS

}

@test "cxys colours command families and failures" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$CXYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;111m⚙ rg foo .\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;70m(exit 0)\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;203m⚙ apply_patch fix\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;196m(exit 1)\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;196m⚠ bad news\033[0m'* ]]
  [[ "$output" == *"in 11, cached 13, out 17"* ]]
}

@test "ocys colours web and edit tool families" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$OCYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;45m▶ hello\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ read\033[0m'* ]]
  [[ "$output" == *"/tmp/AGENTS.md"* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ grep\033[0m'* ]]
  [[ "$output" == *"AGENTS.md in **/*.md"* ]]
  [[ "$output" == *$'\033[38;5;141m⚙ web_fetch\033[0m'* ]]
  [[ "$output" == *"https://example.com"* ]]
  [[ "$output" == *$'\033[38;5;203m⚙ edit\033[0m'* ]]
  [[ "$output" == *"apply patch"* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ task\033[0m'* ]]
  [[ "$output" == *'{"foo":"bar"}'* ]]
  [[ "$output" == *$'\033[38;5;70m✓ step\033[0m'* ]]
}

@test "cxys writes persistent rl usage record" {
  run_zsh_function "$CXYS" prompt

  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/state/agents/rl-usage.jsonl" ]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"provider":"codex"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"runner":"cxys"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"cached_input_tokens":13'* ]]
}
