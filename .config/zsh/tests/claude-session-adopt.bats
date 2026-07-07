#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

ADOPT="$FUNCTIONS_DIR/claude-session-adopt"
REAL_SESSION_LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/lib/claude-session.sh"
RESOLVER="$BATS_TEST_DIRNAME/../../tmux/scripts/claude-session-resolve.py"

setup() {
  setup_test_home
  mkdir -p "$HOME/.claude/sessions"
  export CLAUDE_SESSION_LIB="$REAL_SESSION_LIB"
  export CLAUDE_SESSION_RESOLVER="$RESOLVER"
  write_stub ps <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"-o command= -p 711"*) printf 'claude --resume session-adopted\n' ;;
  *"-axo pid=,command="*) printf '711 claude --resume session-adopted\n' ;;
  *"-o lstart= -p 711"*) printf 'Mon Jul  6 12:34:56 2026\n' ;;
  *) exit 1 ;;
esac
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"-a -p 711 -d cwd"*) printf 'claude 711 user cwd DIR 1,2 0 1 /tmp/work\n' ;;
  *) exit 1 ;;
esac
EOF
  write_stub claude <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) printf '2.1.153\n' ;;
  *) exit 1 ;;
esac
EOF
}

@test "--dry-run shows the adoption candidate without writing" {
  run_zsh_function "$ADOPT" --pid 711 --dry-run

  [ "$status" -eq 0 ]
  [[ "$output" == *"Claude session adoption candidate"* ]]
  [[ "$output" == *"session-adopted"* ]]
  [[ "$output" == *"dry-run: would write"* ]]
  [ ! -e "$HOME/.claude/sessions/711.json" ]
}

@test "--yes writes a Claude pid registry entry from resolver evidence" {
  run_zsh_function "$ADOPT" --pid 711 --yes

  [ "$status" -eq 0 ]
  [ -f "$HOME/.claude/sessions/711.json" ]
  [ "$(jq -r '.sessionId' "$HOME/.claude/sessions/711.json")" = "session-adopted" ]
  [ "$(jq -r '.cwd' "$HOME/.claude/sessions/711.json")" = "/tmp/work" ]
  [ "$(jq -r '.peerProtocol' "$HOME/.claude/sessions/711.json")" = "1" ]
  [ "$(jq -r '.status' "$HOME/.claude/sessions/711.json")" = "idle" ]
}

@test "refuses to overwrite an existing registry entry" {
  cat >"$HOME/.claude/sessions/711.json" <<'EOF'
{"pid":711,"sessionId":"existing-session"}
EOF

  run_zsh_function "$ADOPT" --pid 711 --yes

  [ "$status" -eq 1 ]
  [[ "$output" == *"registry already exists"* ]]
  [ "$(jq -r '.sessionId' "$HOME/.claude/sessions/711.json")" = "existing-session" ]
}
