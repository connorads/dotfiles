#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

AI_USAGE="$FUNCTIONS_DIR/agents/ai-usage"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.local/state/agents"
}

write_provider_stubs() {
  local provider
  for provider in claude codex cosine; do
    write_stub "$provider-usage" <<EOF
#!/usr/bin/env sh
printf '%s:%s\\n' '$provider' "\$*" >>"\$TEST_LOG"
EOF
  done
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
    "seven_day_sonnet": None,
    "limits": [{
        "kind": "weekly_scoped",
        "percent": 4,
        "resets_at": iso(timedelta(days=3)),
        "scope": {"model": {"display_name": "Fable"}},
    }],
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
(home / ".cache/cosine-usage.json").write_text(json.dumps({
    "usedTokens": 420,
    "totalAvailableTokens": 1000,
    "billingPeriodStartsAt": iso(timedelta(days=-40)),
    "billingPeriodResetsAt": iso(timedelta(days=20)),
}))
PY
}

write_cosine_cache() {
  local used="$1"
  local total="$2"
  local start_days="$3"
  local reset_days="$4"

  python3 - "$HOME" "$used" "$total" "$start_days" "$reset_days" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

home = Path(sys.argv[1])
used = int(sys.argv[2])
total = int(sys.argv[3])
start_days = float(sys.argv[4])
reset_days = float(sys.argv[5])
now = datetime.now(timezone.utc)

def iso(delta):
    return (now + delta).isoformat().replace("+00:00", "Z")

(home / ".cache/cosine-usage.json").write_text(json.dumps({
    "usedTokens": used,
    "totalAvailableTokens": total,
    "billingPeriodStartsAt": iso(timedelta(days=start_days)),
    "billingPeriodResetsAt": iso(timedelta(days=reset_days)),
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
  [[ "$output" == *"7d·F"*"4%"* ]]
  [[ "$output" == *"Spark"*"0%"* ]]
  [[ "$output" == *"Cosine"*"mo"*"42%"* ]]
  [[ "$output" == *"Bottleneck"*"Claude 7d 68%"* ]]
  [[ "$output" == *"Headroom"*"Spark 5h has 100% free"* ]]
  [[ "$output" != *"Claude cache"* ]]
  [[ "$output" != *"Codex cache"* ]]
  [[ "$output" != *"Claude extra disabled"* ]]
}

@test "cache-only renders existing caches without invoking providers" {
  write_usage_caches
  write_provider_stubs

  run_zsh_function "$AI_USAGE" --cache-only

  [ "$status" -eq 0 ]
  [[ "$output" == *"AI usage"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "cache-only reports renderer failure without falling back to providers" {
  write_usage_caches
  write_provider_stubs
  write_stub python3 <<'EOF'
#!/usr/bin/env sh
exit 9
EOF

  run_zsh_function "$AI_USAGE" --cache-only

  [ "$status" -ne 0 ]
  [[ "$output" == *"cache renderer failed"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "refresh-only refreshes every provider without output" {
  write_provider_stubs

  run_zsh_function "$AI_USAGE" --refresh-only

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  grep -q '^claude:--all$' "$TEST_LOG"
  grep -q '^codex:$' "$TEST_LOG"
  grep -q '^cosine:$' "$TEST_LOG"
}

@test "refresh-only waits for a provider lock owned by another process" {
  write_provider_stubs
  mkdir "$HOME/.cache/codex-usage.lock"
  (
    sleep 0.6
    rmdir "$HOME/.cache/codex-usage.lock"
    touch "$BATS_TEST_TMPDIR/lock-released"
  ) &
  local remover_pid=$!

  run_zsh_function "$AI_USAGE" --refresh-only
  local refresh_status=$status
  # `wait` first: the remover rmdir's the lock and only then touches the marker,
  # so ai-usage can return in between and the assertion would be reading a file
  # the process it is about has not written yet.
  wait "$remover_pid"
  [ -e "$BATS_TEST_TMPDIR/lock-released" ]

  [ "$refresh_status" -eq 0 ]
}

@test "refresh-only stops waiting at its lock deadline" {
  write_provider_stubs
  mkdir "$HOME/.cache/codex-usage.lock"

  AI_USAGE_REFRESH_TIMEOUT_SECONDS=0 run_zsh_function "$AI_USAGE" --refresh-only

  [ "$status" -eq 0 ]
  [ -d "$HOME/.cache/codex-usage.lock" ]
}

@test "a profile cache adds a second labelled Claude group" {
  write_usage_caches
  python3 - "$HOME" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

home = Path(sys.argv[1])
now = datetime.now(timezone.utc)

def iso(delta):
    return (now + delta).isoformat().replace("+00:00", "Z")

# Profile cache stamped with _label (capitalised, unlike the dir name) so the
# assertion proves the dashboard reads the stamp, not the filename. Its own
# Fable weekly_scoped limit lets us prove the two accounts' Fable rows are now
# distinguishable by account label + 7d·F token (the core regression).
(home / ".cache/claude-usage-acme.json").write_text(json.dumps({
    "five_hour": {"utilization": 33, "resets_at": iso(timedelta(hours=2))},
    "seven_day": {"utilization": 81, "resets_at": iso(timedelta(days=4))},
    "limits": [{
        "kind": "weekly_scoped",
        "percent": 7,
        "resets_at": iso(timedelta(days=3)),
        "scope": {"model": {"display_name": "Fable"}},
    }],
    "_label": "Acme",
    "_profile": "acme",
}))
PY

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  # Default account is still rendered...
  [[ "$output" == *"Claude"*"68%"* ]]
  # ...alongside the profile account's own labelled row.
  [[ "$output" == *"Acme"*"81%"* ]]
  # Both accounts' Fable rows are attributed to their account, distinguished by
  # the account label in column 1 (the model lives in the 7d·F token now).
  [[ "$output" == *"Claude"*"7d·F"* ]]
  [[ "$output" == *"Acme"*"7d·F"* ]]
}

@test "a Sonnet weekly window renders account-labelled with a 7d·S token" {
  write_usage_caches
  python3 - "$HOME" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

home = Path(sys.argv[1])
now = datetime.now(timezone.utc)

def iso(delta):
    return (now + delta).isoformat().replace("+00:00", "Z")

# Populate the model-scoped Sonnet weekly window on the default account.
cache = json.loads((home / ".cache/claude-usage.json").read_text())
cache["seven_day_sonnet"] = {"utilization": 57, "resets_at": iso(timedelta(days=5))}
(home / ".cache/claude-usage.json").write_text(json.dumps(cache))
PY

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  # Sonnet is attributed to its account (Claude) with a 7d·S window token.
  [[ "$output" == *"Claude"*"7d·S"*"57%"* ]]
}

@test "profile meta files are not rendered as accounts" {
  write_usage_caches
  # A stray profile meta sibling must not be picked up as a usage cache.
  jq -n '{last_error:"", last_success_at:0}' \
    >"$HOME/.cache/claude-usage-acme.meta.json"

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" != *"acme"* ]]
  [[ "$output" != *"Acme"* ]]
}

@test "codex weekly-only window is labelled 7d, not a phantom 5h" {
  write_usage_caches
  # Live 2026-07 shape: 5h window removed, weekly figure carries
  # limit_window_seconds:604800 in primary_window. Must render one 7d Codex row.
  python3 - "$HOME" <<'PY'
import json
import sys
from pathlib import Path

home = Path(sys.argv[1])
(home / ".cache/codex-usage.json").write_text(json.dumps({
    "rate_limit": {
        "primary_window": {"used_percent": 98, "limit_window_seconds": 604800, "reset_after_seconds": 530924},
        "secondary_window": None,
    },
    "additional_rate_limits": [],
    "rate_limit_reset_credits": {"available_count": 0},
}))
PY

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  codex_row=$(printf '%s\n' "$output" | grep 'Codex' | head -n1)
  [[ "$codex_row" == *"Codex"*"7d"*"98%"* ]]
  # No Codex line anywhere (row, bottleneck, headroom) mentions a phantom 5h.
  [ -z "$(printf '%s\n' "$output" | grep 'Codex' | grep '5h')" ]
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

@test "cosine monthly pool shows billing-period pace and participates in insights" {
  write_cosine_cache 950 1000 -20 10

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  cosine_row=$(printf '%s\n' "$output" | grep 'Cosine.*mo.*95%' | head -n1)
  [[ "$cosine_row" == *"Cosine"*"mo"*"95%"* ]]
  [[ "$cosine_row" == *"┃"* ]]
  [[ "$cosine_row" == *"pace -"* ]]
  [[ "$output" == *"Bottleneck"*"Cosine mo 95%"*"credits critical"* ]]
  [[ "$output" == *"Headroom"*"Cosine mo has 5% free"* ]]
}

@test "cosine monthly pool can be bottleneck by billing-period pace" {
  write_cosine_cache 400 1000 -1 29
  cat >"$HOME/.cache/claude-usage.json" <<'EOF'
{"five_hour":{"utilization":65,"resets_at":"2099-01-01T01:00:00Z"}}
EOF

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Bottleneck"*"Cosine mo 40%"*"projects empty in"* ]]
}

@test "cosine monthly pool without billing-period start omits pace" {
  cat >"$HOME/.cache/cosine-usage.json" <<'EOF'
{"usedTokens":420,"totalAvailableTokens":1000,"billingPeriodResetsAt":"2099-01-20T00:00:00Z"}
EOF

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  cosine_row=$(printf '%s\n' "$output" | grep 'Cosine.*mo.*42%' | head -n1)
  [[ "$cosine_row" == *"Cosine"*"mo"*"42%"* ]]
  [[ "$cosine_row" != *"pace"* ]]
  [[ "$cosine_row" != *"┃"* ]]
}

@test "fancy dashboard alerts when Cosine cache is stale" {
  write_usage_caches
  set_cache_age_hours "$HOME/.cache/cosine-usage.json" 1

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  cosine_row=$(printf '%s\n' "$output" | grep 'Cosine.*mo.*42%' | head -n1)
  [[ "$cosine_row" == *"▒"* ]]
  [[ "$output" == *"Stale"*"Cosine cache"* ]]
}

@test "fancy dashboard alerts when Claude auth is paused" {
  write_usage_caches
  jq -n '{last_error:"auth_expired", last_http_status:"401", auth_expires_at:111}' >"$HOME/.cache/claude-usage.meta.json"

  run_zsh_function "$AI_USAGE" --fancy

  [ "$status" -eq 0 ]
  [[ "$output" == *"Auth"*"Claude expired"* ]]
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
