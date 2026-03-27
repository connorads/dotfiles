#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TS_HOSTNAME="$FUNCTIONS_DIR/tailscale/ts-hostname"

setup() {
  setup_test_home
}

@test "prints the DNS hostname without the trailing dot" {
  write_stub ts <<'EOF'
#!/usr/bin/env bash
cat <<'JSON'
{"Self":{"DNSName":"mini.example.ts.net."}}
JSON
EOF

  run_zsh_function "$TS_HOSTNAME"

  [ "$status" -eq 0 ]
  [ "$output" = "mini.example.ts.net" ]
}

@test "errors when the hostname cannot be resolved" {
  write_stub ts <<'EOF'
#!/usr/bin/env bash
cat <<'JSON'
{"Self":{"DNSName":null}}
JSON
EOF

  run_zsh_function "$TS_HOSTNAME"

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: could not resolve Tailscale hostname"* ]]
}
