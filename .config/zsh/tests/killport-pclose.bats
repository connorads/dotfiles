#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

KILLPORT="$FUNCTIONS_DIR/shell/killport"
PCLOSE="$FUNCTIONS_DIR/shell/pclose"

setup() {
  setup_test_home
  export KILL_LOG="$BATS_TEST_TMPDIR/kill.log"
  export LSOF_LOG="$BATS_TEST_TMPDIR/lsof.log"
  export PS_OUTPUT="$BATS_TEST_TMPDIR/ps-output.txt"
  export FZF_INPUT_LOG="$BATS_TEST_TMPDIR/fzf-input.log"
  : >"$KILL_LOG"
  : >"$LSOF_LOG"
  : >"$PS_OUTPUT"
  : >"$FZF_INPUT_LOG"
  export KILLPORT_TERM_WAIT=0
  export PCLOSE_TERM_WAIT=0

  write_safe_runner
  write_process_stubs
}

write_safe_runner() {
  export SAFE_ZSH_RUNNER="$BATS_TEST_TMPDIR/safe-zsh-runner.zsh"
  cat >"$SAFE_ZSH_RUNNER" <<'EOF'
#!/usr/bin/env zsh
emulate -L zsh
kill() {
  "$TEST_BIN/kill" "$@"
}
target=$1
shift
source "$target" "$@"
EOF
  chmod +x "$SAFE_ZSH_RUNNER"
}

write_process_stubs() {
  write_stub kill <<'EOF'
#!/usr/bin/env bash
printf 'kill %s\n' "$*" >>"$KILL_LOG"
if [ "${1:-}" = "-0" ]; then
  case " ${KILL_SURVIVORS:-} " in
    *" ${2:-} "*) exit 0 ;;
    *) exit 1 ;;
  esac
fi
exit 0
EOF

  write_stub sleep <<'EOF'
#!/usr/bin/env bash
printf 'sleep %s\n' "$*" >>"$KILL_LOG"
EOF

  write_stub lsof <<'EOF'
#!/usr/bin/env bash
printf 'lsof %s\n' "$*" >>"$LSOF_LOG"
case "$*" in
  *-tiTCP:3000*) printf '101\n102\n101\n' ;;
  *-tiTCP:3001*) printf '201\n' ;;
  *-tiTCP:443*) printf '4430\n' ;;
  *) exit 0 ;;
esac
EOF

  write_stub ps <<'EOF'
#!/usr/bin/env bash
cat "$PS_OUTPUT"
EOF

  write_stub fzf <<'EOF'
#!/usr/bin/env bash
cat >"$FZF_INPUT_LOG"
if [ -n "${FZF_EXIT:-}" ]; then
  exit "$FZF_EXIT"
fi
if [ -n "${FZF_SELECTION:-}" ]; then
  printf '%s\n' "$FZF_SELECTION"
fi
EOF

  write_stub sudo <<'EOF'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >>"$KILL_LOG"
if [ "$1 $2" = "-n true" ]; then
  exit "${SUDO_AUTH_STATUS:-1}"
fi
exec "$@"
EOF
}

run_safe_zsh() {
  local target=$1
  shift
  run zsh --no-rcs "$SAFE_ZSH_RUNNER" "$target" "$@"
}

@test "killport prints usage when no ports are given" {
  run_safe_zsh "$KILLPORT"

  [ "$status" -eq 1 ]
  [[ "$output" == *"usage: killport"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "killport rejects non-numeric ports" {
  run_safe_zsh "$KILLPORT" nope

  [ "$status" -eq 1 ]
  [[ "$output" == *"invalid port: nope"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "killport reports no listener and does not kill" {
  run_safe_zsh "$KILLPORT" 65535

  [ "$status" -eq 1 ]
  [[ "$output" == *"no listener found on port 65535"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "killport refuses protected ports non-interactively without --yes" {
  run_safe_zsh "$KILLPORT" 443

  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing to kill protected port(s) without --yes: 443"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "killport sends TERM once to unique listener pids" {
  run_safe_zsh "$KILLPORT" 3000

  [ "$status" -eq 0 ]
  [[ "$output" == *"sending TERM to 2 process(es): 101 102"* ]]
  [[ "$output" == *"all processes exited after TERM"* ]]
  grep -Fxq 'kill -TERM 101 102' "$KILL_LOG"
  grep -Fxq 'kill -0 101' "$KILL_LOG"
  grep -Fxq 'kill -0 102' "$KILL_LOG"
  ! grep -q -- '-KILL' "$KILL_LOG"
}

@test "killport refuses KILL for survivors in non-interactive mode" {
  export KILL_SURVIVORS="201"

  run_safe_zsh "$KILLPORT" 3001

  [ "$status" -eq 1 ]
  [[ "$output" == *"still running after TERM: 201"* ]]
  [[ "$output" == *"non-interactive mode: refusing KILL without --force or --yes"* ]]
  grep -Fxq 'kill -TERM 201' "$KILL_LOG"
  ! grep -q -- '-KILL' "$KILL_LOG"
}

@test "killport --force sends KILL to survivors" {
  export KILL_SURVIVORS="201"

  run_safe_zsh "$KILLPORT" --force 3001

  [ "$status" -eq 0 ]
  grep -Fxq 'kill -TERM 201' "$KILL_LOG"
  grep -Fxq 'kill -KILL 201' "$KILL_LOG"
}

@test "pclose rejects unknown options" {
  run_safe_zsh "$PCLOSE" --bogus

  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown option: --bogus"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "pclose reports no processes" {
  run_safe_zsh "$PCLOSE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"no processes found"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "pclose returns success when fzf selection is cancelled" {
  printf '4242 1 0.0 0.1 00:01 connor sleep sleep 999\n' >"$PS_OUTPUT"
  export FZF_EXIT=130

  run_safe_zsh "$PCLOSE"

  [ "$status" -eq 0 ]
  [ ! -s "$KILL_LOG" ]
  grep -q '4242' "$FZF_INPUT_LOG"
}

@test "pclose sends TERM to selected pid" {
  printf '4242 1 0.0 0.1 00:01 connor sleep sleep 999\n' >"$PS_OUTPUT"
  export FZF_SELECTION=$' \t4242\t1\t0.0\t0.1\t00:01\tconnor\tsleep\tsleep 999'

  run_safe_zsh "$PCLOSE"

  [ "$status" -eq 0 ]
  [[ "$output" == *"sending TERM to 1 process(es): 4242"* ]]
  grep -Fxq 'kill -TERM 4242' "$KILL_LOG"
  grep -Fxq 'kill -0 4242' "$KILL_LOG"
  ! grep -q -- '-KILL' "$KILL_LOG"
}

@test "pclose refuses protected selected pid without --yes" {
  printf '1 0 0.0 0.1 99:99 root launchd launchd\n' >"$PS_OUTPUT"
  export FZF_SELECTION=$'!\t1\t0\t0.0\t0.1\t99:99\troot\tlaunchd\tlaunchd'

  run_safe_zsh "$PCLOSE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing protected process(es) without --yes: 1"* ]]
  [ ! -s "$KILL_LOG" ]
}

@test "pclose refuses KILL for survivors in non-interactive mode" {
  printf '4242 1 0.0 0.1 00:01 connor sleep sleep 999\n' >"$PS_OUTPUT"
  export FZF_SELECTION=$' \t4242\t1\t0.0\t0.1\t00:01\tconnor\tsleep\tsleep 999'
  export KILL_SURVIVORS="4242"

  run_safe_zsh "$PCLOSE"

  [ "$status" -eq 1 ]
  [[ "$output" == *"still running after TERM: 4242"* ]]
  [[ "$output" == *"non-interactive mode: refusing KILL without --force or --yes"* ]]
  grep -Fxq 'kill -TERM 4242' "$KILL_LOG"
  ! grep -q -- '-KILL' "$KILL_LOG"
}

@test "pclose --force sends KILL to survivors" {
  printf '4242 1 0.0 0.1 00:01 connor sleep sleep 999\n' >"$PS_OUTPUT"
  export FZF_SELECTION=$' \t4242\t1\t0.0\t0.1\t00:01\tconnor\tsleep\tsleep 999'
  export KILL_SURVIVORS="4242"

  run_safe_zsh "$PCLOSE" --force

  [ "$status" -eq 0 ]
  grep -Fxq 'kill -TERM 4242' "$KILL_LOG"
  grep -Fxq 'kill -KILL 4242' "$KILL_LOG"
}

@test "pclose --sudo fails closed in non-interactive mode when sudo auth is unavailable" {
  run_safe_zsh "$PCLOSE" --sudo

  [ "$status" -eq 1 ]
  [[ "$output" == *"sudo required for --sudo in non-interactive mode"* ]]
  grep -Fxq 'sudo -n true' "$KILL_LOG"
  ! grep -q '^kill ' "$KILL_LOG"
}
