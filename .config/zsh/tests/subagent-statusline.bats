#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# Drives the real script by piping a fixture payload to stdin and asserting on
# stdout. No claude, no agent panel - the contract is JSONL in, JSONL out.

SCRIPT="$BATS_TEST_DIRNAME/../../../.claude/subagent-statusline.sh"

setup() {
  [ -f "$SCRIPT" ] || skip "subagent-statusline.sh not found at $SCRIPT"
  command -v jq >/dev/null || skip "jq not installed"
}

# Strip SGR sequences so a width assertion counts what the panel renders.
plain() { sed $'s/\033\\[[0-9;]*m//g'; }

# One task, overridable field by field. Callers pass whole JSON fragments.
payload() {
  local cols=$1 tasks=$2
  printf '{"session_id":"s","cwd":"/tmp","columns":%s,"tasks":%s}' "$cols" "$tasks"
}

@test "emits one JSONL line per task, keyed by id" {
  run -0 bash "$SCRIPT" <<<"$(payload 200 '[
    {"id":"t1","name":"general-purpose","label":"grepping","model":"claude-fable-5-1",
     "contextWindowSize":200000,"tokenCount":41000},
    {"id":"t2","name":"Explore","label":"reading","model":"claude-haiku-4-5-20251001",
     "contextWindowSize":200000,"tokenCount":8000}
  ]')"
  [ "$(echo "$output" | wc -l | tr -d ' ')" = 2 ]
  [ "$(echo "$output" | jq -r -s 'map(.id) | join(",")')" = "t1,t2" ]
  # Every line must be parseable JSON with both keys present.
  echo "$output" | jq -e 'has("id") and has("content")' >/dev/null
}

@test "model id renders as a display label, with the context gauge" {
  run -0 bash "$SCRIPT" <<<"$(payload 200 '[
    {"id":"t1","name":"worker","label":"grepping","model":"claude-haiku-4-5-20251001",
     "contextWindowSize":200000,"tokenCount":8000}
  ]')"
  content=$(echo "$output" | jq -r '.content' | plain)
  [[ $content == *"Haiku 4.5"* ]]
  [[ $content == *"8k (4%)"* ]]
  [[ $content == *"grepping"* ]]
}

@test "a task with no resolved model still gets a row" {
  run -0 bash "$SCRIPT" <<<"$(payload 200 '[
    {"id":"t1","name":"worker","label":"starting up"}
  ]')"
  [ "$(echo "$output" | jq -r '.id')" = t1 ]
  content=$(echo "$output" | jq -r '.content' | plain)
  [[ $content == *"worker"* ]]
  [[ $content == *"starting up"* ]]
}

@test "name falls back to description, and is not then repeated as the label" {
  run -0 bash "$SCRIPT" <<<"$(payload 200 '[
    {"id":"t1","type":"local_bash","description":"npm test","tokenCount":0}
  ]')"
  [ "$(echo "$output" | jq -r '.content')" = "npm test" ]
}

@test "content is truncated to columns" {
  long='{"id":"t1","name":"general-purpose","label":"grepping inngest consumers in jobs and elsewhere","model":"claude-fable-5-1","contextWindowSize":200000,"tokenCount":41000}'
  run -0 bash "$SCRIPT" <<<"$(payload 40 "[$long]")"
  # Count codepoints, not bytes: the ` · ` separator is multibyte, so awk in the
  # C locale would report a width the panel never sees.
  width=$(echo "$output" | jq -r '.content | gsub("\u001b\\[[0-9;]*m"; "") | length')
  [ "$width" -eq 40 ]

  # Same row, room to spare: no truncation, so the label survives whole.
  run -0 bash "$SCRIPT" <<<"$(payload 200 "[$long]")"
  content=$(echo "$output" | jq -r '.content' | plain)
  [[ $content == *"grepping inngest consumers in jobs and elsewhere" ]]
}

@test "context colour band flips above 50% and above 80%" {
  band() {
    run -0 bash "$SCRIPT" <<<"$(payload 200 "[{\"id\":\"t1\",\"name\":\"n\",\"label\":\"l\",\"model\":\"claude-opus-5\",\"contextWindowSize\":100,\"tokenCount\":$1}]")"
    echo "$output" | jq -r '.content' | grep -o $'\033\\[3[0-9]m0k' | head -1
  }
  # Verbatim from statusline.sh: white <= 50, yellow 51-80, red > 80.
  [ "$(band 50)" = $'\033[37m0k' ]
  [ "$(band 51)" = $'\033[33m0k' ]
  [ "$(band 80)" = $'\033[33m0k' ]
  [ "$(band 81)" = $'\033[31m0k' ]
}

@test "zero tokenCount drops the gauge but keeps the row" {
  run -0 bash "$SCRIPT" <<<"$(payload 200 '[
    {"id":"t1","name":"worker","label":"starting","model":"claude-opus-5",
     "contextWindowSize":200000,"tokenCount":0}
  ]')"
  content=$(echo "$output" | jq -r '.content' | plain)
  [[ $content == *"Opus 5"* ]]
  [[ $content != *"%"* ]]
}

@test "null tokenCount, no tasks, malformed input and empty stdin all exit 0 silently" {
  run -0 bash "$SCRIPT" <<<'{"columns":80,"tasks":[{"id":"t1","name":"n","label":"l","tokenCount":null}]}'
  [ "$(echo "$output" | jq -r '.id')" = t1 ]

  run -0 bash "$SCRIPT" <<<'{"columns":80,"tasks":[]}'
  [ -z "$output" ]

  run -0 bash "$SCRIPT" <<<'not json at all'
  [ -z "$output" ]

  run -0 bash "$SCRIPT" </dev/null
  [ -z "$output" ]
}

# Drift guard. The setting is what makes every test above matter: drop it and
# the rows silently revert to their default, with nothing else in the tree
# saying so. ~48ms against the 217MB binary. Skips when claude is absent,
# matching the never-brick posture of ts-typecheck.sh and bats-tests.sh.
@test "the installed claude binary still ships subagentStatusLine" {
  bin=$(command -v claude) || skip "claude not on PATH"
  real=$(readlink -f "$bin" 2>/dev/null || echo "$bin")
  LC_ALL=C grep -qa subagentStatusLine "$real"
}
