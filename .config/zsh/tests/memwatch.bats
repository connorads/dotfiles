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
  *'-o rss= -p 91,92') printf ' 1048576\n 1048576\n' ;;
  *'-p 1 -o command='*) echo '/Applications/App1.app/Contents/MacOS/App1' ;;
  *'-p 2 -o command='*) echo '/Applications/App2.app/Contents/MacOS/App2' ;;
  *'-p 3 -o command='*) echo '/Applications/App3.app/Contents/MacOS/App3' ;;
  *'-p 4 -o command='*) echo '/Applications/App4.app/Contents/MacOS/App4' ;;
  *'-p 5 -o command='*) echo '/Applications/App5.app/Contents/MacOS/App5' ;;
  *'-p 6 -o command='*) echo '/Applications/App6.app/Contents/MacOS/App6' ;;
esac
STUB

  # vm_stat at a 1 MB page size, so FAKE_WIRED_MB pages are that many MB.
  write_stub vm_stat <<'STUB'
#!/usr/bin/env bash
printf 'Mach Virtual Memory Statistics: (page size of 1048576 bytes)\n'
printf 'Pages wired down: %s.\n' "${FAKE_WIRED_MB:-3686}"
STUB

  # top: WindowServer (pid 77) has a 2.0G footprint.
  write_stub top <<'STUB'
#!/usr/bin/env bash
[ "$*" = "-l 1 -pid 77 -stats pid,mem" ] && printf 'Processes: 1 total\nPID  MEM\n77   2048M+\n'
STUB

  # pgrep: WindowServer is pid 77 (2.0G footprint in the top stub); with FAKE_CHROME
  # set, chrome-headless-shell is pids 91 and 92 (1.0G each).
  write_stub pgrep <<'STUB'
#!/usr/bin/env bash
[ "$*" = "-x WindowServer" ] && echo 77 && exit 0
[ "$*" = "-x chrome-headless-shell" ] && [ -n "${FAKE_CHROME:-}" ] && printf '91\n92\n' && exit 0
exit 1
STUB

  export PKILL_LOG="$BATS_TEST_TMPDIR/pkill.log"
  write_stub pkill <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$PKILL_LOG"
STUB

  write_stub osascript <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$OSASCRIPT_LOG"
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
  grep -Eq '^[0-9T:-]+  state=BUSY  cause=slots  pressure=1  swap=6\.0G  wired=3\.6G  ws=2\.0G  slots=62%  segs=27%  ratio=2\.3$' "$MEMWATCH_LOG"
}

@test "the banner names both arms with their distance to the next line, swap and the top app" {
  export FAKE_SLOTS=620 FAKE_SEGS=270 FAKE_SWAP=6144.00M

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  grep -q 'display notification "slots 62% (18 to red) · segs 27% (43 to amber) · swap 6.0G · wired 3.6G · WS 2.0G · top: App6 ≈6M" with title "Memory BUSY"' "$OSASCRIPT_LOG"
}

@test "warn pressure with a resting compressor logs nothing and posts no banner" {
  export FAKE_PRESSURE=2 FAKE_SLOTS=300 FAKE_SEGS=300

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -s "$MEMWATCH_LOG" ]
  [ ! -e "$OSASCRIPT_LOG" ]
}

@test "critical pressure is CRITICAL with cause pressure and the level in the log" {
  export FAKE_PRESSURE=4 FAKE_SLOTS=300 FAKE_SEGS=300

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  grep -q '  state=CRITICAL  cause=pressure  pressure=4  ' "$MEMWATCH_LOG"
  grep -q 'with title "Memory CRITICAL"' "$OSASCRIPT_LOG"
}

@test "wired at the critical line is CRITICAL with cause wired while the compressor idles" {
  export FAKE_WIRED_MB=13000

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  grep -q '  state=CRITICAL  cause=wired  pressure=1  swap=0M  wired=12\.7G  ws=2\.0G  slots=0%' "$MEMWATCH_LOG"
  grep -q '· wired 12.7G · WS 2.0G · .*with title "Memory CRITICAL"' "$OSASCRIPT_LOG"
}

@test "a sustained unchanged reading is logged once, even with the cooldown lapsed" {
  export FAKE_SLOTS=620 MEMWATCH_TICKS=3 MEMWATCH_INTERVAL=0.1 MEMWATCH_COOLDOWN=0

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  [ "$(grep -c '  state=BUSY  ' "$MEMWATCH_LOG")" -eq 1 ]
  [ "$(grep -c 'display notification' "$OSASCRIPT_LOG")" -eq 1 ]
}

@test "a sustained reading is re-logged once an arm moves by the delta against the last line" {
  # The compressor counter is popped from a sequence per gather: 62%, then 62%
  # again (621 truncates), then 65% - three points past the last logged 62%.
  export SLOTS_SEQ="$BATS_TEST_TMPDIR/slots.seq"
  printf '620\n621\n650\n' >"$SLOTS_SEQ"
  write_stub sysctl <<'STUB'
#!/usr/bin/env bash
shift
for key in "$@"; do
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo 1 ;;
    vm.swapusage) echo "total = 12288.00M  used = 0.00M  free = 100.00M  (encrypted)" ;;
    vm.compressor.pages_compressed)
      v=$(head -n1 "$SLOTS_SEQ")
      [ "$(wc -l <"$SLOTS_SEQ")" -gt 1 ] && sed -i '' 1d "$SLOTS_SEQ"
      echo "$v" ;;
    vm.compressor.pages_compressed_limit) echo 1000 ;;
    vm.compressor.segment.total) echo 0 ;;
    vm.compressor.segment.limit) echo 1000 ;;
  esac
done
STUB
  export MEMWATCH_TICKS=3 MEMWATCH_INTERVAL=0.1 MEMWATCH_COOLDOWN=0

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  [ "$(grep -c '  state=BUSY  ' "$MEMWATCH_LOG")" -eq 2 ]
  grep -q '  slots=62%  ' "$MEMWATCH_LOG"
  grep -q '  slots=65%  ' "$MEMWATCH_LOG"
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

# --- CRITICAL ----------------------------------------------------------------

@test "CRITICAL kills every headless Chrome, logs it and posts a banner" {
  export FAKE_SLOTS=820 FAKE_CHROME=1

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ "$(cat "$PKILL_LOG")" = "-KILL -x chrome-headless-shell" ]
  grep -Eq '^[0-9T:-]+  killed=chrome-headless-shell  n=2  rss=2\.0G  cause=slots$' "$MEMWATCH_LOG"
  grep -q 'display notification "2 chrome-headless-shell ≈2.0G · cause slots" with title "Memory CRITICAL: killed headless Chrome"' "$OSASCRIPT_LOG"
  grep -q '  state=CRITICAL  cause=slots  ' "$MEMWATCH_LOG"
}

@test "CRITICAL with no headless Chrome kills nothing" {
  export FAKE_SLOTS=820

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -e "$PKILL_LOG" ]
  ! grep -q 'killed=' "$MEMWATCH_LOG"
}

@test "BUSY with headless Chrome kills nothing" {
  export FAKE_SLOTS=620 FAKE_CHROME=1

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -e "$PKILL_LOG" ]
  ! grep -q 'killed=' "$MEMWATCH_LOG"
}

@test "MEMWATCH_KILL=0 reports CRITICAL and kills nothing" {
  export FAKE_SLOTS=820 FAKE_CHROME=1 MEMWATCH_KILL=0

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  [ ! -e "$PKILL_LOG" ]
  grep -q '  state=CRITICAL  cause=slots  ' "$MEMWATCH_LOG"
}

@test "a sustained CRITICAL kills a respawned Chrome on every tick" {
  export FAKE_SLOTS=820 FAKE_CHROME=1 MEMWATCH_TICKS=2 MEMWATCH_INTERVAL=0.1

  run_zsh_function "$MEMWATCH"

  [ "$status" -eq 0 ]
  [ "$(grep -c -- '-KILL -x chrome-headless-shell' "$PKILL_LOG")" -eq 2 ]
}

@test "CRITICAL never hibernates" {
  export FAKE_SLOTS=820 FAKE_CHROME=1

  run_zsh_function "$MEMWATCH" --once

  [ "$status" -eq 0 ]
  ! grep -q 'hibernat' "$MEMWATCH_LOG"
}
