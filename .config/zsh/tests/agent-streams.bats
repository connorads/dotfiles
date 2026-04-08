#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CYS="$FUNCTIONS_DIR/agents/cys"
CXYS="$FUNCTIONS_DIR/agents/cxys"
OCYS="$FUNCTIONS_DIR/agents/ocys"
PIS="$FUNCTIONS_DIR/agents/pis"
RL="$FUNCTIONS_DIR/agents/rl"

setup() {
  setup_test_home

  write_stub claude <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","name":"Read","input":{"file":"AGENTS.md"}},{"type":"tool_use","name":"Edit","input":{"file":"notes.md"}}]}}
{"type":"result","subtype":"success","duration_ms":1234,"total_cost_usd":0.0123,"usage":{"input_tokens":3,"cache_creation_input_tokens":7,"cache_read_input_tokens":5,"output_tokens":4}}
JSON
EOS

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

  write_stub pi <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"session","version":3,"id":"test","timestamp":"2026-04-08T00:00:00.000Z","cwd":"/tmp"}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"assistant","content":[],"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"hello"},"message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}
{"type":"tool_execution_start","toolCallId":"1","toolName":"read","args":{"path":"AGENTS.md"}}
{"type":"tool_execution_end","toolCallId":"1","toolName":"read","result":{"path":"AGENTS.md"},"isError":false}
{"type":"tool_execution_start","toolCallId":"2","toolName":"edit","args":{"path":"notes.md"}}
{"type":"tool_execution_end","toolCallId":"2","toolName":"edit","result":{"ok":false},"isError":true}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"usage":{"input":12,"output":4,"cacheRead":3,"cacheWrite":0,"cost":{"total":0.0456}}}}
{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"usage":{"input":12,"output":4,"cacheRead":3,"cacheWrite":0,"cost":{"total":0.0456}}},"toolResults":[]}
{"type":"agent_end","messages":[]}
JSON
EOS
}

@test "cys stays plain when stdout is not a TTY" {
  run_zsh_function "$CYS" prompt

  [ "$status" -eq 0 ]
  [[ "$output" == *"▶ hello"* ]]
  [[ "$output" == *"⚙ Read"* ]]
  [[ "$output" == *"in 3, cached 5, out 4, 1.234s, \$0.0123"* ]]
  [[ "$output" != *$'\033['* ]]
}

@test "cys adds semantic colours in a TTY" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$CYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;45m▶ hello\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ Read\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;203m⚙ Edit\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;70m✓ done\033[0m'* ]]
  [[ "$output" == *"in 3, cached 5, out 4, 1.234s, \$0.0123"* ]]
}

@test "cys honours NO_COLOR even in a TTY" {
  run_in_tty "env PATH=\"$PATH\" NO_COLOR=1 zsh --no-rcs \"$CYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *"▶ hello"* ]]
  [[ "$output" != *$'\033['* ]]
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

@test "rl promise mode preserves cys colours in a TTY" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$RL\" 1 -- \"$CYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;45m▶ hello\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ Read\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;70m✓ done\033[0m'* ]]
  [[ "$output" == *"total, in 3, cached 5, out 4, 1.234s, \$0.012"* ]]
}

@test "rl promise mode preserves cxys colours in a TTY" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$RL\" 1 -- \"$CXYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;111m⚙ rg foo .\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;203m⚙ apply_patch fix\033[0m'* ]]
  [[ "$output" == *"total, in 11, cached 13, out 17"* ]]
}

@test "rl promise mode still honours NO_COLOR" {
  run_in_tty "env PATH=\"$PATH\" NO_COLOR=1 zsh --no-rcs \"$RL\" 1 -- \"$CYS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *"▶ hello"* ]]
  [[ "$output" != *$'\033[38;5;45m▶ hello\033[0m'* ]]
  [[ "$output" != *$'\033[38;5;111m⚙ Read\033[0m'* ]]
  [[ "$output" == *"total, in 3, cached 5, out 4, 1.234s, \$0.012"* ]]
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

@test "pis stays plain when stdout is not a TTY" {
  run_zsh_function "$PIS" prompt

  [ "$status" -eq 0 ]
  [[ "$output" == *"▶ hello"* ]]
  [[ "$output" == *"⚙ read — {\"path\":\"AGENTS.md\"}"* ]]
  [[ "$output" == *"✓ read"* ]]
  [[ "$output" == *"⚠ edit failed"* ]]
  [[ "$output" == *"in 12, cached 3, out 4, \$0.0456"* ]]
  [[ "$output" != *$'\033['* ]]
}

@test "pis adds semantic colours in a TTY" {
  run_in_tty "env -u NO_COLOR PATH=\"$PATH\" zsh --no-rcs \"$PIS\" prompt"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[38;5;45m▶ hello\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;111m⚙ read\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;70m✓ read\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;196m⚠ edit failed\033[0m'* ]]
  [[ "$output" == *"in 12, cached 3, out 4, \$0.0456"* ]]
}

@test "cys writes persistent rl usage record without prompt text" {
  run_zsh_function "$CYS" prompt

  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/state/agents/rl-usage.jsonl" ]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"provider":"claude"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"runner":"cys"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"input_tokens":3'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" != *'"prompt"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" != *'hello'* ]]
}

@test "cxys writes persistent rl usage record" {
  run_zsh_function "$CXYS" prompt

  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/state/agents/rl-usage.jsonl" ]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"provider":"codex"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"runner":"cxys"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"cached_input_tokens":13'* ]]
}

@test "pis writes persistent rl usage record" {
  run_zsh_function "$PIS" prompt

  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/state/agents/rl-usage.jsonl" ]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"provider":"pi"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"runner":"pis"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"input_tokens":12'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"cached_input_tokens":3'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"success":true'* ]]
}

@test "cys records usage for Claude error results" {
  write_stub claude <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"assistant","message":{"content":[{"type":"text","text":"oops"}]}}
{"type":"result","subtype":"error","is_error":true,"duration_ms":2500,"total_cost_usd":0.0456,"usage":{"input_tokens":9,"cache_creation_input_tokens":2,"cache_read_input_tokens":1,"output_tokens":6}}
JSON
EOS

  run_zsh_function "$CYS" prompt

  [ "$status" -eq 0 ]
  [ -f "$HOME/.local/state/agents/rl-usage.jsonl" ]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"provider":"claude"'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"input_tokens":9'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"cached_input_tokens":1'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"output_tokens":6'* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"success":false'* ]]
}

@test "rl aggregate totals include Claude error-result usage" {
  write_stub claude <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"assistant","message":{"content":[{"type":"text","text":"retrying"}]}}
{"type":"result","subtype":"error","is_error":true,"duration_ms":1500,"total_cost_usd":0.02,"usage":{"input_tokens":5,"cache_creation_input_tokens":1,"cache_read_input_tokens":2,"output_tokens":4}}
JSON
EOS

  run_zsh_function "$RL" 1 -- "$CYS" prompt

  [ "$status" -eq 0 ]
  [[ "$output" == *"total, in 5, cached 2, out 4, 1.5s, \$0.02 across 1 runs"* || "$output" == *"total, in 5, cached 2, out 4, 1.5s, \$0.0200 across 1 runs"* ]]
}

@test "cys does not treat cache creation as cached usage" {
  write_stub claude <<'EOS'
#!/usr/bin/env bash
cat <<'JSON'
{"type":"assistant","message":{"content":[{"type":"text","text":"warming cache"}]}}
{"type":"result","subtype":"success","duration_ms":900,"total_cost_usd":0.01,"usage":{"input_tokens":8,"cache_creation_input_tokens":6,"output_tokens":2}}
JSON
EOS

  run_zsh_function "$CYS" prompt

  [ "$status" -eq 0 ]
  [[ "$output" == *"in 8, cached 0, out 2, 0.9s, \$0.01"* || "$output" == *"in 8, cached 0, out 2, 0.900s, \$0.01"* ]]
  [[ "$(cat "$HOME/.local/state/agents/rl-usage.jsonl")" == *'"cached_input_tokens":0'* ]]
}
