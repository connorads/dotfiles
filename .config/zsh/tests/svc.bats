#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

SVC="$FUNCTIONS_DIR/agents/svc"

setup() {
  setup_test_home
}

write_svc_stubs() {
  write_stub ts-hostname <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${TS_HOSTNAME_VALUE:-host.tailnet.ts.net}"
exit "${TS_HOSTNAME_STATUS:-0}"
EOF

  write_stub ts <<'EOF'
#!/usr/bin/env bash
printf 'ts %s\n' "$*" >>"$TEST_LOG"
EOF

  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "has-session" ]; then
  exit "${TMUX_HAS_SESSION_STATUS:-1}"
fi
exit 0
EOF

  write_stub remobi <<'EOF'
#!/usr/bin/env bash
printf 'remobi %s\n' "$*" >>"$TEST_LOG"
EOF
}

@test "no args defaults to listing services in non-interactive mode" {
  write_svc_stubs

  run_zsh_function "$SVC"

  [ "$status" -eq 0 ]
  [[ "$output" == *"SERVICE"* ]]
  [[ "$output" == *"remobi"* ]]
  [[ "$output" == *"toad"* ]]
  [[ "$output" == *"gigacode"* ]]
  [[ "$output" == *"companion"* ]]
}

@test "ls probes service status without starting or stopping services" {
  write_svc_stubs

  run_zsh_function "$SVC" ls

  [ "$status" -eq 0 ]
  grep -q '^tmux has-session -t remobi$' "$TEST_LOG"
  grep -q '^tmux has-session -t toad$' "$TEST_LOG"
  grep -q '^tmux has-session -t gigacode$' "$TEST_LOG"
  grep -q '^tmux has-session -t companion$' "$TEST_LOG"
  ! grep -q '^ts serve' "$TEST_LOG"
}

@test "unknown service fails before mutating anything" {
  write_svc_stubs

  run_zsh_function "$SVC" up bogus

  [ "$status" -eq 1 ]
  [[ "$output" == *"error: unknown service 'bogus'"* ]]
  [[ "$output" == *"available: remobi, toad, gigacode, companion"* ]]
  [ ! -s "$TEST_LOG" ]
}

@test "ui reports missing fzf" {
  write_svc_stubs

  run env PATH="/usr/bin:/bin:/usr/sbin:/sbin" "$(command -v zsh)" --no-rcs "$SVC" ui

  [ "$status" -eq 1 ]
  [[ "$output" == *"fzf required"* ]]
}

@test "up toad aborts when hostname lookup fails" {
  write_svc_stubs
  export TS_HOSTNAME_STATUS=42

  run_zsh_function "$SVC" up toad

  [ "$status" -eq 1 ]
  [ ! -s "$TEST_LOG" ]
}

@test "up gigacode uses custom local port and fixed external https port" {
  write_svc_stubs

  run_zsh_function "$SVC" up gigacode 9999

  [ "$status" -eq 0 ]
  [[ "$output" == *"gigacode: https://host.tailnet.ts.net:2468"* ]]
  grep -Fxq 'tmux kill-session -t gigacode' "$TEST_LOG"
  grep -Fq 'tmux new-session -d -s gigacode' "$TEST_LOG"
  grep -Fq 'gigacode server --host 127.0.0.1 --port 9999 --no-token' "$TEST_LOG"
  grep -Fxq 'ts serve --bg --https=2468 9999' "$TEST_LOG"
}

@test "restart tears down then starts the selected service" {
  write_svc_stubs

  run_zsh_function "$SVC" restart toad

  [ "$status" -eq 0 ]
  [[ "$output" == *"toad stopped"* ]]
  [[ "$output" == *"toad: https://host.tailnet.ts.net:8000"* ]]
  expected=$'tmux kill-session -t toad\nts serve --https=8000 off\ntmux kill-session -t toad'
  [[ "$(head -n 3 "$TEST_LOG")" = "$expected" ]]
  grep -Fxq 'ts serve --bg --https=8000 8000' "$TEST_LOG"
}

@test "up remobi runs in a managed tmux session on its collision-free port" {
  write_svc_stubs

  run_zsh_function "$SVC" up remobi

  [ "$status" -eq 0 ]
  [[ "$output" == *"remobi: https://host.tailnet.ts.net"* ]]
  grep -Fxq 'tmux kill-session -t remobi' "$TEST_LOG"
  grep -Fq 'tmux new-session -d -s remobi' "$TEST_LOG"
  grep -Fq 'remobi serve --no-sleep --port 7682 -- tmux new-session -A -s main' "$TEST_LOG"
  grep -Fxq 'ts serve --bg --https=443 7682' "$TEST_LOG"
}

@test "down remobi stops its managed tmux session and apex serve" {
  write_svc_stubs

  run_zsh_function "$SVC" down remobi

  [ "$status" -eq 0 ]
  [[ "$output" == *"remobi stopped"* ]]
  grep -Fxq 'tmux kill-session -t remobi' "$TEST_LOG"
  grep -Fxq 'ts serve --https=443 off' "$TEST_LOG"
}

@test "failure propagation from tmux or ts is deferred pending implementation decision" {
  skip "current svc may print success after some external failures; test once behaviour is specified"
}
