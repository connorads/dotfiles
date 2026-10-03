#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# Drives the real status line with fixture payloads and asserts on the cache
# segment only. No claude - the contract is the stdin JSON's prompt_cache and
# context_window.current_usage fields in, one rendered line out.

SCRIPT="$BATS_TEST_DIRNAME/../../../.claude/statusline.sh"

setup() {
  [ -f "$SCRIPT" ] || skip "statusline.sh not found at $SCRIPT"
  command -v jq >/dev/null || skip "jq not installed"
  now=$(date +%s)
}

plain() { sed $'s/\033\\[[0-9;]*m//g'; }

# Base payload with last-turn usage; $1 is a jq expression adding prompt_cache.
render() {
  jq -cn '{model:{display_name:"Opus 5.5"},workspace:{current_dir:"/tmp"},
    context_window:{used_percentage:13,context_window_size:1000000,
      current_usage:{input_tokens:2,output_tokens:249,
        cache_creation_input_tokens:1340,cache_read_input_tokens:129691}}}' |
    jq -c "$1" | bash "$SCRIPT" | plain
}

@test "warm cache shows TTL countdown, hit %, last-turn write/read" {
  out=$(render ". + {prompt_cache:{caching_observed:true,ttl:\"1h\",
    expires_at:$((now + 3130)),hit_ratio:0.963,misses:0,last_miss_cause:null}}")
  [[ $out == *"● 1h 52:1"* ]]
  [[ $out == *"hit 96%"* ]]
  [[ $out == *"+1.3k/129k"* ]]
  [[ $out != *"miss"* ]]
}

@test "misses show count and last diagnosed causes" {
  out=$(render ". + {prompt_cache:{caching_observed:true,ttl:\"5m\",
    expires_at:$((now + 200)),hit_ratio:0.5,misses:2,
    last_miss_cause:{causes:[\"tools_changed\",\"unknown\"]}}}")
  [[ $out == *"2 miss (tools_changed,unknown)"* ]]
}

@test "expired cache shows cold and the tokens the next request re-caches" {
  out=$(render ". + {prompt_cache:{caching_observed:true,ttl:\"1h\",
    expires_at:$((now - 10)),hit_ratio:0.91,misses:0,recache_tokens_if_cold:131033}}")
  [[ $out == *"○ cold · rebuild 131k"* ]]
}

@test "null expires_at reads as cold" {
  out=$(render '. + {prompt_cache:{caching_observed:true,ttl:"5m",expires_at:null,misses:0}}')
  [[ $out == *"○ cold"* ]]
}

@test "caching never observed shows cache off" {
  out=$(render '. + {prompt_cache:{caching_observed:false,ttl:"5m",expires_at:null,misses:0}}')
  [[ $out == *"cache off" ]]
}

@test "no prompt_cache before the first response adds no segment" {
  out=$(render '.context_window.current_usage = null')
  [[ $out != *"cache"* ]]
  [[ $out != *"·"* ]]
}

@test "the installed claude binary still ships prompt_cache.recache_tokens_if_cold" {
  real=$(mise which claude 2>/dev/null) || {
    bin=$(command -v claude) || skip "claude not on PATH"
    real=$(readlink -f "$bin" 2>/dev/null || echo "$bin")
  }
  LC_ALL=C grep -qa recache_tokens_if_cold "$real"
}
