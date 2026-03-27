#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TS="$FUNCTIONS_DIR/tailscale/ts"

setup() {
  setup_test_home
}

@test "errors when tailscale is not installed" {
  run -127 zsh --no-rcs "$TS" status

  [ "$status" -eq 127 ]
  [[ "$output" == *"tailscale not installed"* ]]
}

@test "uses the linux runtime socket when present" {
  write_stub tailscale <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
EOF

  local expected_socket
  if [[ "$OSTYPE" == darwin* ]]; then
    expected_socket="/var/run/tailscale/tailscaled.sock"
  else
    export XDG_RUNTIME_DIR="$(mktemp -d /tmp/ts-runtime.XXXXXX)"
    mkdir -p "$XDG_RUNTIME_DIR/tailscale"
    create_unix_socket "$XDG_RUNTIME_DIR/tailscale/tailscaled.sock"
    expected_socket="$XDG_RUNTIME_DIR/tailscale/tailscaled.sock"
  fi

  run_zsh_function "$TS" status --json

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"--socket $expected_socket status --json"* ]]
}

@test "falls back to plain tailscale invocation without a socket" {
  write_stub tailscale <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
EOF

  run env OSTYPE=linux-gnu zsh --no-rcs "$TS" ping devbox

  [ "$status" -eq 0 ]
  [[ "$(cat "$TEST_LOG")" == *"ping devbox"* ]]
}
