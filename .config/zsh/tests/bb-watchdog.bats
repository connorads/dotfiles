#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
source "$BATS_TEST_DIRNAME/test_helper.bash"

WATCHDOG="$FUNCTIONS_DIR/agents/bb-watchdog"

setup() {
  setup_test_home
  mkdir -p "$HOME/.bb/logs"
  echo '{"msg":"Host plugin worker ready"}' >"$HOME/.bb/logs/host-daemon.48.log"
  write_stub pgrep <<'EOF'
#!/usr/bin/env bash
[ "${DAEMON_RUNNING:-1}" = 1 ] && echo 4242
EOF
  write_stub curl <<'EOF'
#!/usr/bin/env bash
[ "${API_EXIT:-0}" = 0 ] || exit "$API_EXIT"
echo "${RUNNING_JSON:-[]}"
EOF
  write_stub sample <<'EOF'
#!/usr/bin/env bash
echo "sample $*" >>"$TEST_LOG"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -file ]; then shift; echo 'Thread_1 stack' >"$1"; fi
  shift
done
EOF
  local tool
  for tool in lsof ps vm_stat df; do
    write_stub "$tool" <<EOF
#!/usr/bin/env bash
echo "$tool \$*" >>"\$TEST_LOG"
echo "$tool output"
EOF
  done
}

quiet_log() {
  touch -t "$(date -v-10M +%Y%m%d%H%M.%S)" "$HOME/.bb/logs/host-daemon.48.log"
}

captures() {
  find "$HOME/.local/state/bb-watchdog" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
}

@test "fresh daemon log records nothing" {
  export RUNNING_JSON='[{"id":"thr_busy"}]'
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [ "$(captures)" -eq 0 ]
  ! grep -q '^sample ' "$TEST_LOG"
}

@test "quiet log on an idle BB records nothing" {
  quiet_log
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [ "$(captures)" -eq 0 ]
}

@test "missing daemon records nothing" {
  quiet_log
  export DAEMON_RUNNING=0 RUNNING_JSON='[{"id":"thr_busy"}]'
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [ "$(captures)" -eq 0 ]
}

@test "quiet log while threads run captures daemon evidence" {
  quiet_log
  export RUNNING_JSON='[{"id":"thr_busy"}]'
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [[ "$output" == *'quiet while threads run'* ]]
  capture=$(find "$HOME/.local/state/bb-watchdog" -mindepth 1 -maxdepth 1 -type d)
  [[ "$capture" == *-4242 ]]
  grep -q 'Thread_1' "$capture/sample.txt"
  grep -q 'thr_busy' "$capture/running.json"
  grep -q '^sample 4242 5 -file ' "$TEST_LOG"
  grep -q '^lsof -n -p 4242$' "$TEST_LOG"
  for file in lsof ps vm_stat df daemon-log-tail reason; do [ -s "$capture/$file.txt" ]; done
}

@test "unavailable thread state with a quiet log captures evidence" {
  quiet_log
  export API_EXIT=28
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [[ "$output" == *'state unavailable'* ]]
  [ "$(captures)" -eq 1 ]
}

@test "a recent capture suppresses another" {
  quiet_log
  export RUNNING_JSON='[{"id":"thr_busy"}]'
  zsh -f "$WATCHDOG"
  run zsh -f "$WATCHDOG"
  [ "$status" -eq 0 ]
  [ "$(captures)" -eq 1 ]
  [ "$(grep -c '^sample ' "$TEST_LOG")" -eq 1 ]
}
