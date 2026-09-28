#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SSH_FN="$FUNCTIONS_DIR/tailscale/ssh"
LOGIN_URL="https://login.tailscale.com/a/l1af0b312f83b4"

setup() {
  setup_test_home
  export SSH_STDERR="$BATS_TEST_TMPDIR/ssh-stderr"
  export SSH_EXIT=0
  : >"$SSH_STDERR"

  write_stub ssh <<'EOF'
#!/usr/bin/env bash
printf 'arg:%s\n' "$@"
cat "$SSH_STDERR" >&2
exit "$SSH_EXIT"
EOF

  write_stub qrencode <<'EOF'
#!/usr/bin/env bash
printf 'QR:%s\n' "${!#}"
EOF
}

@test "prints a QR code under a Tailscale login link" {
  printf '# Tailscale SSH requires an additional check.\n# To authenticate, visit: %s\n' "$LOGIN_URL" >"$SSH_STDERR"

  run_zsh_function "$SSH_FN" mini-agent

  [ "$status" -eq 0 ]
  [[ "$output" == *"# To authenticate, visit: $LOGIN_URL"$'\n'"QR:$LOGIN_URL"* ]]
}

@test "passes other stderr through without a QR code" {
  printf 'Warning: Permanently added host\n' >"$SSH_STDERR"

  run_zsh_function "$SSH_FN" mini-agent

  [ "$status" -eq 0 ]
  [[ "$output" == *"Warning: Permanently added host"* ]]
  [[ "$output" != *"QR:"* ]]
}

@test "keeps ssh's exit status and passes args unchanged" {
  export SSH_EXIT=255

  run_zsh_function "$SSH_FN" -o 'ProxyCommand nc %h %p' mini-agent

  [ "$status" -eq 255 ]
  [[ "$output" == *$'arg:-o\narg:ProxyCommand nc %h %p\narg:mini-agent'* ]]
}

@test "prints a final stderr line with no newline" {
  printf 'Connection closed' >"$SSH_STDERR"

  run_zsh_function "$SSH_FN" mini-agent

  [ "$status" -eq 0 ]
  [[ "$output" == *"Connection closed"* ]]
}

@test "prints the banner without a QR code when qrencode is missing" {
  rm "$TEST_BIN/qrencode"
  printf '# To authenticate, visit: %s\n' "$LOGIN_URL" >"$SSH_STDERR"
  PATH=$(path_without qrencode)

  run_zsh_function "$SSH_FN" mini-agent

  [ "$status" -eq 0 ]
  [[ "$output" == *"visit: $LOGIN_URL"* ]]
  [[ "$output" != *"QR:"* ]]
  [[ "$output" != *"not found"* ]]
}
