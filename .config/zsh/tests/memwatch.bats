#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it
# for an isolated temp dir. memwatch reads the lib through MEM_LIB, so the real
# file is handed over explicitly; every kernel and system tool it forks is a
# PATH stub below.
MEMWATCH="$HOME/.config/zsh/functions/macos/memwatch"
MEM_LIB="$HOME/.config/tmux/scripts/mem-lib.sh"

setup() {
  [ "$(uname)" = Darwin ] || skip "memwatch is macOS-only ($OSTYPE guard)"
  setup_test_home
  export MEM_LIB
  export MEMWATCH_LOG="$BATS_TEST_TMPDIR/memwatch.log"
  export OSASCRIPT_LOG="$BATS_TEST_TMPDIR/osascript.log"
  export SLEEP_LOG="$BATS_TEST_TMPDIR/sleep.log"
  # A one-second overrun is both logged and critical, so the stall tests spend
  # ~1 s of real sleep each rather than the production 2 s / 5 s.
  export MEMWATCH_STALL_LOG_SECS=1 MEMWATCH_STALL_CRITICAL_SECS=1

  # sysctl in the multi-key loop form the lib gathers with. Idle defaults;
  # FAKE_SLOTS / FAKE_SEGS are against fixed limits of 1000 (620 = 62%).
  write_stub sysctl <<'STUB'
#!/usr/bin/env bash
shift
for key in "$@"; do
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo "${FAKE_PRESSURE:-1}" ;;
    vm.swapusage) echo "total = 12288.00M  used = ${FAKE_SWAP:-0.00M}  free = 100.00M  (encrypted)" ;;
    vm.compressor.pages_compressed) echo "${FAKE_SLOTS:-0}" ;;
    vm.compressor.pages_compressed_limit) echo 1000 ;;
    vm.compressor.segment.total) echo "${FAKE_SEGS:-0}" ;;
    vm.compressor.segment.limit) echo 1000 ;;
  esac
done
STUB

  # footprint: each pid's footprint is its pid in MB, so App6 is the top hog.
  write_stub footprint <<'STUB'
#!/usr/bin/env bash
pid="${2:-0}"
printf '    phys_footprint: %s MB\n' "${pid:-0}"
STUB

  write_stub ps <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *'-axo pid=,rss='*)
    cat <<'OUT'
6 600
5 500
4 400
3 300
2 200
1 100
OUT
    ;;
  *'-axo pid=,ppid='*)
    cat <<'OUT'
100 1
101 100
200 1
201 200
300 1
OUT
    ;;
  *'-p 1 -o command='*) echo '/Applications/App1.app/Contents/MacOS/App1' ;;
  *'-p 2 -o command='*) echo '/Applications/App2.app/Contents/MacOS/App2' ;;
  *'-p 3 -o command='*) echo '/Applications/App3.app/Contents/MacOS/App3' ;;
  *'-p 4 -o command='*) echo '/Applications/App4.app/Contents/MacOS/App4' ;;
  *'-p 5 -o command='*) echo '/Applications/App5.app/Contents/MacOS/App5' ;;
  *'-p 6 -o command='*) echo '/Applications/App6.app/Contents/MacOS/App6' ;;
esac
STUB

  write_stub osascript <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$OSASCRIPT_LOG"
STUB

  write_stub tmux <<'STUB'
#!/usr/bin/env bash
if [ "$1" = list-panes ]; then
  printf '%s\n' "${TMUX_PANES:-}"
fi
STUB

  # sleep: logs what was asked, then really sleeps that plus SLEEP_EXTRA, so an
  # overrun is produced rather than simulated - the probe measures wall-clock.
  write_stub sleep <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >>"$SLEEP_LOG"
exec /bin/sleep "$(awk -v a="$1" -v b="${SLEEP_EXTRA:-0}" 'BEGIN { print a + b }')"
STUB
}

# --- reading and reporting ---------------------------------------------------

@test "OK logs nothing and posts no banner" {
  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -s "$MEMWATCH_LOG" ]
  [ ! -e "$OSASCRIPT_LOG" ]
}

@test "a BUSY transition logs the reading line" {
  export FAKE_SLOTS=620 FAKE_SEGS=270 FAKE_SWAP=6144.00M

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  grep -Eq '^[0-9T:-]+  state=BUSY  cause=slots  swap=6\.0G  slots=62%  segs=27%  ratio=2\.3$' "$MEMWATCH_LOG"
}

@test "the banner names both arms, swap and the top app" {
  export FAKE_SLOTS=620 FAKE_SEGS=270 FAKE_SWAP=6144.00M

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  grep -q 'display notification "slots 62% · segs 27% · swap 6.0G · top: App6 ≈6M" with title "Memory BUSY"' "$OSASCRIPT_LOG"
}

@test "the log carries the top-5 rows and no leaked parameter echo" {
  export FAKE_SLOTS=620 FAKE_SEGS=270

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ "$(grep -c '^  App[0-9] ' "$MEMWATCH_LOG")" -eq 5 ]
  grep -q '^  App6 *≈6M (1)$' "$MEMWATCH_LOG"
  # A zsh `local` on an already-set parameter prints "name=value"; none may
  # reach the log.
  ! grep -Eq '^[a-z_]+=' "$MEMWATCH_LOG"
}

# --- the liveness probe -------------------------------------------------------

@test "a sleep overrun writes a stall line" {
  export MEMWATCH_TICKS=2 MEMWATCH_INTERVAL=0.1 SLEEP_EXTRA=1

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  grep -Eq '^[0-9T:-]+  stall=[12]s  interval=0\.1s$' "$MEMWATCH_LOG"
}

@test "a stall at the critical threshold makes the next tick CRITICAL with cause stall" {
  export MEMWATCH_TICKS=2 MEMWATCH_INTERVAL=0.1 SLEEP_EXTRA=1

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  grep -q '  state=CRITICAL  cause=stall  ' "$MEMWATCH_LOG"
  grep -q 'with title "Memory CRITICAL"' "$OSASCRIPT_LOG"
}

@test "a sleep that returns on time is neither logged nor critical" {
  export MEMWATCH_TICKS=2 MEMWATCH_INTERVAL=0.1

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  [ ! -s "$MEMWATCH_LOG" ]
  [ "$(cat "$SLEEP_LOG")" = "0.1" ]
}

@test "--once never sleeps" {
  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -e "$SLEEP_LOG" ]
}
