#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

AI_USAGE="$FUNCTIONS_DIR/agents/ai-usage"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.local/state/agents"
}

write_usage_caches() {
  python3 - "$HOME" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

home = Path(sys.argv[1])
now = datetime.now(timezone.utc)

def iso(delta):
    return (now + delta).isoformat().replace("+00:00", "Z")

(home / ".cache/claude-usage.json").write_text(json.dumps({
    "five_hour": {"utilization": 19, "resets_at": iso(timedelta(hours=1, minutes=30))},
    "seven_day": {"utilization": 68, "resets_at": iso(timedelta(days=3))},
    "seven_day_sonnet": {"utilization": 0, "resets_at": iso(timedelta(days=3))},
    "extra_usage": {"is_enabled": False, "monthly_limit": 0, "used_credits": 0},
}))
(home / ".cache/codex-usage.json").write_text(json.dumps({
    "rate_limit": {
        "limit_reached": False,
        "primary_window": {"used_percent": 20, "reset_after_seconds": 5400},
        "secondary_window": {"used_percent": 12, "reset_after_seconds": 508800},
    },
    "additional_rate_limits": [{
        "limit_name": "GPT-5.3-Codex-Spark",
        "rate_limit": {
            "primary_window": {"used_percent": 0, "reset_after_seconds": 18000},
            "secondary_window": {"used_percent": 0, "reset_after_seconds": 604800},
        },
    }],
    "rate_limit_reset_credits": {"available_count": 0},
}))
PY
}

set_cache_age_hours() {
  python3 - "$1" "$2" <<'PY'
import os
import sys
import time

path, hours = sys.argv[1], float(sys.argv[2])
t = time.time() - hours * 3600
os.utime(path, (t, t))
PY
}

@test "fancy dashboard renders useful insights and hides normal footers" {
  write_usage_caches

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"AI usage"* ]]
  [[ "$output" == *"Claude"*"68%"* ]]
  [[ "$output" == *"Spark"*"0%"* ]]
  [[ "$output" == *"Bottleneck"*"Claude 7d 68%"* ]]
  [[ "$output" == *"Headroom"*"Spark 5h has 100% free"* ]]
  [[ "$output" != *"Claude cache"* ]]
  [[ "$output" != *"Codex cache"* ]]
  [[ "$output" != *"Claude extra disabled"* ]]
}

@test "stale 7d reading still wins the bottleneck, flagged stale" {
  write_usage_caches
  set_cache_age_hours "$HOME/.cache/claude-usage.json" 9

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Bottleneck"*"Claude 7d 68%"*"cache stale"* ]]
  [[ "$output" != *"Bottleneck Codex"* ]]
  [[ "$output" == *"Stale"*"Claude cache"* ]]
  [[ "$output" == *"▒"* ]]
}

@test "7d reading tolerates hours of staleness before being distrusted" {
  write_usage_caches
  set_cache_age_hours "$HOME/.cache/claude-usage.json" 3

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Bottleneck"*"Claude 7d 68%"* ]]
  [[ "$output" != *"cache stale"* ]]
}

@test "stale caches are alerts, stale local run history is hidden" {
  write_usage_caches
  touch -t 202001010000 "$HOME/.cache/claude-usage.json" "$HOME/.cache/codex-usage.json"
  cat >"$HOME/.local/state/agents/rl-usage.jsonl" <<'EOF'
{"ts":"2020-01-01T00:00:00Z","provider":"claude","runner":"cys","cached_input_tokens":1234,"output_tokens":56,"total_cost_usd":0.12}
EOF

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Stale"*"Claude cache"* ]]
  [[ "$output" == *"Stale"*"Codex cache"* ]]
  [[ "$output" != *"claude/cys"* ]]
}

@test "fresh local run history is summarised" {
  write_usage_caches
  python3 - "$HOME/.local/state/agents/rl-usage.jsonl" <<'PY'
import json
import sys
from datetime import datetime, timezone

record = {
    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "provider": "claude",
    "runner": "cys",
    "cached_input_tokens": 175219,
    "output_tokens": 838,
    "total_cost_usd": 0.38261575,
}
with open(sys.argv[1], "w") as f:
    f.write(json.dumps(record) + "\n")
PY

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Last"*"claude/cys"* ]]
  [[ "$output" == *"Today"*"1 runs"* ]]
  [[ "$output" == *"cached 175.2k"* ]]
}
