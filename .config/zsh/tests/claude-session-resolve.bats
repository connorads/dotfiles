#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/projects/-tmp-work"
}

@test "resolves from the live pid registry first" {
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-registry","cwd":"/tmp/work","name":"demo","status":"busy"}
EOF

  run python3 "$RESOLVER" --pid 711

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "registry" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-registry" ]
  [ "$(printf '%s' "$output" | jq -r '.claudeStatus')" = "busy" ]
}

@test "resolves from Claude launch arguments when the registry is missing" {
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"-o command= -p 711"*) printf 'claude --resume session-from-args\n' ;;
  *) exit 1 ;;
esac
EOF

  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "launch-args" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-from-args" ]
}

@test "resolves from visible pane content when process metadata is insufficient" {
  cat >"$HOME/.claude/projects/-tmp-work/session-content.jsonl" <<'EOF'
{"sessionId":"session-content","type":"user","message":{"content":"Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes"}}
EOF
  capture="$BATS_TEST_TMPDIR/capture.txt"
  cat >"$capture" <<'EOF'
Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work --capture-file "$capture"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "content-match" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-content" ]
}

@test "resolves from the registry under a profile config dir" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/sessions"
  cat >"$cfg/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-profile","cwd":"/tmp/work","name":"demo","status":"busy"}
EOF

  run python3 "$RESOLVER" --pid 711 --config-dir "$cfg"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "registry" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-profile" ]
}

@test "does not resolve the default registry when a profile config dir is given" {
  # Session only exists under the default account; the profile dir has none.
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"session-default","cwd":"/tmp/work"}
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  local acct=acme
  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work --config-dir "$HOME/.claude-profiles/code/$acct"

  [ "$status" -ne 0 ]
  [ "$(printf '%s' "$output" | jq -r '.status')" = "unresolved" ]
}

@test "resolves from an open transcript under a profile config dir" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/projects/-tmp-work"
  cat >"$cfg/projects/-tmp-work/session-open.jsonl" <<'EOF'
{"sessionId":"session-open","type":"user","message":{"content":"hello"}}
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub lsof <<EOF
#!/usr/bin/env bash
printf 'n%s/projects/-tmp-work/session-open.jsonl\n' "$cfg"
EOF

  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work --config-dir "$cfg"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "open-jsonl" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-open" ]
}

@test "resolves from visible pane content under a profile config dir" {
  local acct=acme
  local cfg="$HOME/.claude-profiles/code/$acct"
  mkdir -p "$cfg/projects/-tmp-work"
  cat >"$cfg/projects/-tmp-work/session-content.jsonl" <<'EOF'
{"sessionId":"session-content","type":"user","message":{"content":"Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes"}}
EOF
  capture="$BATS_TEST_TMPDIR/capture.txt"
  cat >"$capture" <<'EOF'
Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work --capture-file "$capture" --config-dir "$cfg"

  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.source')" = "content-match" ]
  [ "$(printf '%s' "$output" | jq -r '.sessionId')" = "session-content" ]
}

@test "content matching refuses equal-scored transcript candidates" {
  for name in one two; do
    cat >"$HOME/.claude/projects/-tmp-work/session-$name.jsonl" <<'EOF'
{"sessionId":"session-ambiguous","type":"user","message":{"content":"Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes"}}
EOF
  done
  capture="$BATS_TEST_TMPDIR/capture.txt"
  cat >"$capture" <<'EOF'
Could you look into reverse engineering claude maybe in order to devise some way of always getting the pid from sandboxed panes
EOF
  write_stub ps <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run python3 "$RESOLVER" --pid 711 --cwd /tmp/work --capture-file "$capture"

  [ "$status" -eq 2 ]
  [ "$(printf '%s' "$output" | jq -r '.status')" = "ambiguous" ]
  [ "$(printf '%s' "$output" | jq -r '.reason')" = "multiple transcripts matched equally" ]
}
