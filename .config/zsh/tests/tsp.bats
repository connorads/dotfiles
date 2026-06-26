#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TSP="$FUNCTIONS_DIR/tailscale/tsp"

setup() {
  setup_test_home
  export TS_SERVE_JSON="$BATS_TEST_TMPDIR/serve.json"
  export LISTENING_LINES="$BATS_TEST_TMPDIR/listeners.txt"
  printf '{}\n' >"$TS_SERVE_JSON"
  : >"$LISTENING_LINES"
}

write_tsp_stubs() {
  write_stub ts-hostname <<'EOF'
#!/usr/bin/env bash
printf 'host.tailnet.ts.net\n'
EOF

  write_stub listening-lines <<'EOF'
#!/usr/bin/env bash
cat "$LISTENING_LINES"
EOF

  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf 'ts %s\n' "$*" >>"$TEST_LOG"
case "$*" in
  "status --self --json") printf '{"Self":{"DNSName":"host.tailnet.ts.net."}}\n' ;;
  "serve status --json") cat "$TS_SERVE_JSON" ;;
esac
EOF
}

write_routes_json() {
  cat >"$TS_SERVE_JSON" <<'EOF'
{
  "Web": {
    "host.tailnet.ts.net:3000": {
      "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } }
    },
    "host.tailnet.ts.net:9999": {
      "Handlers": { "/": { "Proxy": "http://127.0.0.1:9999" } }
    }
  },
  "AllowFunnel": {
    "host.tailnet.ts.net:9999": true
  }
}
EOF
}

write_listener_for_3000() {
  # Field 4 is Linux ss-style addr; field 9 is macOS lsof-style addr.
  printf 'node 1234 x 127.0.0.1:3000 x users:(("node",pid=1234,fd=10)) y z 127.0.0.1:3000\n' >"$LISTENING_LINES"
}

@test "missing ts dependency fails before doing work" {
  run env PATH="$(dirname "$(command -v zsh)"):/usr/bin:/bin:/usr/sbin:/sbin" zsh --no-rcs "$TSP" ls

  [ "$status" -eq 1 ]
  [[ "$output" == *"missing required command(s):"* ]]
  [[ "$output" == *"ts"* ]]
}

@test "ls reports no active serve routes" {
  write_tsp_stubs

  run_zsh_function "$TSP" ls

  [ "$status" -eq 0 ]
  [[ "$output" == *"not serving"* ]]
}

@test "ls --json reports healthy and stale routes" {
  write_tsp_stubs
  write_routes_json
  write_listener_for_3000

  run_zsh_function "$TSP" ls --json

  [ "$status" -eq 0 ]
  json="$output"
  run jq -r 'length' <<<"$json"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
  run jq -r '.[] | select(.httpsPort == 3000) | .status + " " + .mode + " " + (.localPort|tostring)' <<<"$json"
  [ "$status" -eq 0 ]
  [ "$output" = "ok tailnet 3000" ]
}

@test "up serves the local port on the same https port" {
  write_tsp_stubs

  run_zsh_function "$TSP" up 3000

  [ "$status" -eq 0 ]
  [[ "$output" == *"Serve (tailnet): https://host.tailnet.ts.net:3000  ->  3000"* ]]
  grep -Fxq 'ts serve --bg --https=3000 3000' "$TEST_LOG"
}

@test "up --https uses a distinct external port" {
  write_tsp_stubs

  run_zsh_function "$TSP" up --https 8443 3000

  [ "$status" -eq 0 ]
  [[ "$output" == *"https://host.tailnet.ts.net:8443"* ]]
  grep -Fxq 'ts serve --bg --https=8443 3000' "$TEST_LOG"
}

@test "down --yes removes the selected served route" {
  write_tsp_stubs
  write_routes_json

  run_zsh_function "$TSP" down 3000 --yes

  [ "$status" -eq 0 ]
  [[ "$output" == *"removed :3000 -> http://127.0.0.1:3000"* ]]
  grep -Fxq 'ts serve --https=3000 off' "$TEST_LOG"
}

@test "prune --dry-run reports stale routes without removing them" {
  write_tsp_stubs
  write_routes_json
  write_listener_for_3000

  run_zsh_function "$TSP" prune --dry-run

  [ "$status" -eq 0 ]
  [[ "$output" == *"stale routes:"* ]]
  [[ "$output" == *":9999 -> http://127.0.0.1:9999"* ]]
  ! grep -q 'serve --https=9999 off' "$TEST_LOG"
}
