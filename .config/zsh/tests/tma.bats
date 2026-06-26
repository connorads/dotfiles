#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TMA="$FUNCTIONS_DIR/tmux/tma"

setup() {
  setup_test_home
  # Stub tmux: log every call; has-session / switch-client exit codes are
  # driven by env so each test can model a different client state.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
case "$1" in
has-session) [ "${TMA_HAS_SESSION:-1}" = "1" ] ;;
switch-client) [ "${TMA_SWITCH_OK:-1}" = "1" ] ;;
*) true ;;
esac
EOF
}

@test "switches when inside a real tmux client" {
  run env TMUX="/tmp/sock,1,0" TMA_HAS_SESSION=1 TMA_SWITCH_OK=1 \
    zsh --no-rcs "$TMA"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"switch-client -t main"* ]]
  [[ "$(cat "$TEST_LOG")" != *"attach"* ]]
}

@test "falls back to attach when \$TMUX is stale (switch-client fails)" {
  run env TMUX="/tmp/sock,1,0" TMA_HAS_SESSION=1 TMA_SWITCH_OK=0 \
    zsh --no-rcs "$TMA"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"switch-client -t main"* ]]
  [[ "$(cat "$TEST_LOG")" == *"attach -t main"* ]]
}

@test "attaches directly when not in tmux" {
  run env -u TMUX TMA_HAS_SESSION=1 zsh --no-rcs "$TMA"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"attach -t main"* ]]
  [[ "$(cat "$TEST_LOG")" != *"switch-client"* ]]
}

@test "creates the session then attaches when it does not exist" {
  run env -u TMUX TMA_HAS_SESSION=0 zsh --no-rcs "$TMA"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"new-session -ds main"* ]]
  [[ "$(cat "$TEST_LOG")" == *"attach -t main"* ]]
}

@test "honours an explicit session name argument" {
  run env -u TMUX TMA_HAS_SESSION=1 zsh --no-rcs "$TMA" work

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"attach -t work"* ]]
}
