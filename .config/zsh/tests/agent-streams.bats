#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CYS="$FUNCTIONS_DIR/agents/cys"
CXYS="$FUNCTIONS_DIR/agents/cxys"
OCYS="$FUNCTIONS_DIR/agents/ocys"
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
{"type":"tool_use","part":{"tool":"web_fetch","state":{"status":"completed","input":{"description":"https://example.com"}}}}
{"type":"tool_use","part":{"tool":"edit","state":{"status":"completed","input":{"command":"apply patch"}}}}
{"type":"step_finish","part":{"tokens":{"total":42},"cost":0.0098}}
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
  [[ "$output" == *$'\033[38;5;141m⚙ web_fetch\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;203m⚙ edit\033[0m'* ]]
  [[ "$output" == *$'\033[38;5;70m✓ step\033[0m'* ]]
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
