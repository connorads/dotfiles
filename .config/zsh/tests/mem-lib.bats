#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it
# for an isolated temp dir. The lib reads nothing from HOME (sysctl/footprint
# come via the PATH shims), so sourcing the real file is correct.
MEM_LIB="$HOME/.config/tmux/scripts/mem-lib.sh"

setup() {
  setup_test_home

  # sysctl shim driven by env, in the multi-key loop form the lib gathers with:
  # FAKE_PRESSURE for the pressure level, FAKE_SWAP for the literal vm.swapusage
  # "used = …" token (e.g. 3109.69M, 1.50G), FAKE_SLOTS / FAKE_SEGS as the two
  # compressor counters against fixed limits of 1000, so FAKE_SLOTS=620 is 62%.
  # Each invocation logs one `call` line plus its keys to $TEST_LOG.
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
shift
echo call >>"$TEST_LOG"
for key in "$@"; do
  echo "$key" >>"$TEST_LOG"
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo "${FAKE_PRESSURE:-1}" ;;
    vm.swapusage) echo "total = 4096.00M  used = ${FAKE_SWAP:-0.00M}  free = 100.00M  (encrypted)" ;;
    vm.compressor.pages_compressed) echo "${FAKE_SLOTS:-0}" ;;
    vm.compressor.pages_compressed_limit) echo 1000 ;;
    vm.compressor.segment.total) echo "${FAKE_SEGS:-0}" ;;
    vm.compressor.segment.limit) echo 1000 ;;
  esac
done
EOF

  # footprint shim: emits FAKE_FP as the "phys_footprint:" value+unit.
  write_stub footprint <<'EOF'
#!/usr/bin/env bash
echo "    phys_footprint: ${FAKE_FP:-509 MB}"
EOF
}

lib() {
  run bash -c "source '$MEM_LIB'; $*"
}

# --- mem_state mapping across (pressure, slots%, segments%) -----------------

@test "pure memory derivation reuses gathered pressure and compressor fill" {
  lib 'mem_state_from 2 30 30'
  [ "$output" = "BUSY" ]
  lib 'mem_cause_from 2 30 30'
  [ "$output" = "pressure" ]
  lib 'mem_token_from 2 30 30'
  [ "$output" = "▲" ]
}

@test "OK when pressure normal and both arms under their BUSY lines" {
  FAKE_PRESSURE=1 FAKE_SLOTS=590 FAKE_SEGS=690 lib mem_state
  [ "$output" = "OK" ]
}

@test "BUSY when slots reach 60% even with segments empty" {
  FAKE_PRESSURE=1 FAKE_SLOTS=600 FAKE_SEGS=0 lib mem_state
  [ "$output" = "BUSY" ]
}

@test "BUSY when segments reach 70% even with slots empty" {
  FAKE_PRESSURE=1 FAKE_SLOTS=0 FAKE_SEGS=700 lib mem_state
  [ "$output" = "BUSY" ]
}

@test "CRITICAL when slots reach 80%" {
  FAKE_PRESSURE=1 FAKE_SLOTS=800 FAKE_SEGS=0 lib mem_state
  [ "$output" = "CRITICAL" ]
}

@test "CRITICAL when segments reach 85%" {
  FAKE_PRESSURE=1 FAKE_SLOTS=0 FAKE_SEGS=850 lib mem_state
  [ "$output" = "CRITICAL" ]
}

@test "BUSY on warn pressure with an empty compressor" {
  FAKE_PRESSURE=2 lib mem_state
  [ "$output" = "BUSY" ]
}

@test "CRITICAL on critical pressure level" {
  FAKE_PRESSURE=4 lib mem_state
  [ "$output" = "CRITICAL" ]
}

@test "threshold knobs are env-overridable" {
  MEM_BUSY_SLOTS_PCT=10 FAKE_PRESSURE=1 FAKE_SLOTS=100 lib mem_state
  [ "$output" = "BUSY" ]
  MEM_CRITICAL_SEGS_PCT=20 FAKE_PRESSURE=1 FAKE_SEGS=200 lib mem_state
  [ "$output" = "CRITICAL" ]
}

# --- mem_cause: which signal drives the active state -----------------------

@test "cause none when OK" {
  FAKE_PRESSURE=1 FAKE_SLOTS=260 FAKE_SEGS=270 lib mem_cause
  [ "$output" = "none" ]
}

@test "cause pressure on warn pressure with a resting compressor" {
  FAKE_PRESSURE=2 FAKE_SLOTS=300 FAKE_SEGS=300 lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause slots when slots drive BUSY at normal pressure" {
  FAKE_PRESSURE=1 FAKE_SLOTS=620 FAKE_SEGS=270 lib mem_cause
  [ "$output" = "slots" ]
}

@test "cause segments when segments drive BUSY at normal pressure" {
  FAKE_PRESSURE=1 FAKE_SLOTS=260 FAKE_SEGS=720 lib mem_cause
  [ "$output" = "segments" ]
}

@test "cause pressure on critical pressure level" {
  FAKE_PRESSURE=4 lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause pressure when both fire at BUSY (pressure wins)" {
  FAKE_PRESSURE=2 FAKE_SLOTS=620 lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause pressure when both fire at CRITICAL (pressure wins)" {
  FAKE_PRESSURE=4 FAKE_SLOTS=820 lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause slots when CRITICAL via slots but pressure only 2 (active-state-line rule)" {
  # State is CRITICAL (slots >= 80%) but pressure 2 < CRITICAL's line of 4, so
  # the compressor is the driver, not pressure.
  FAKE_PRESSURE=2 FAKE_SLOTS=820 lib mem_cause
  [ "$output" = "slots" ]
}

@test "higher arm binds when both reach the line" {
  lib 'mem_cause_from 1 62 72'
  [ "$output" = "segments" ]
}

@test "arm at the CRITICAL line binds over a higher BUSY arm" {
  lib 'mem_cause_from 1 82 84'
  [ "$output" = "slots" ]
}

@test "ties between the arms bind to slots" {
  lib 'mem_binding_arm 65 60 65 60'
  [ "$output" = "slots" ]
}

# --- mem_token: marker when pressure-driven, else the binding arm's fill -----

@test "token is the cause marker when pressure drives the state" {
  FAKE_PRESSURE=2 FAKE_SLOTS=300 lib mem_token
  [ "$output" = "▲" ]
}

@test "token is the slots percentage when slots drive the state" {
  FAKE_PRESSURE=1 FAKE_SLOTS=620 FAKE_SEGS=270 lib mem_token
  [ "$output" = "62%" ]
}

@test "token is the segments percentage when segments drive the state" {
  FAKE_PRESSURE=1 FAKE_SLOTS=260 FAKE_SEGS=720 lib mem_token
  [ "$output" = "72%" ]
}

@test "token is the higher arm's percentage (resting baseline) when OK" {
  FAKE_PRESSURE=1 FAKE_SLOTS=260 FAKE_SEGS=270 lib mem_token
  [ "$output" = "27%" ]
}

# --- compressor arithmetic ---------------------------------------------------

@test "percentage truncates and reads zero on an unknown limit" {
  lib 'mem_pct_from 620 1000'
  [ "$output" = "62" ]
  lib 'mem_pct_from 999 1000'
  [ "$output" = "99" ]
  lib 'mem_pct_from 5 0'
  [ "$output" = "0" ]
}

@test "ratio is pages per segment to one decimal, zero without segments" {
  lib 'mem_ratio_from 1480914 196301'
  [ "$output" = "7.5" ]
  lib 'mem_ratio_from 100 0'
  [ "$output" = "0.0" ]
}

@test "compressor counters are gathered in one sysctl fork" {
  FAKE_SLOTS=620 FAKE_SEGS=270 lib mem_compressor_raw
  [ "$output" = "620 1000 270 1000" ]
  [ "$(grep -c '^call$' "$TEST_LOG")" -eq 1 ]
  [ "$(grep -c '^vm.compressor.pages_compressed$' "$TEST_LOG")" -eq 1 ]
  [ "$(grep -c '^vm.compressor.segment.limit$' "$TEST_LOG")" -eq 1 ]
}

@test "a short sysctl answer collapses to zeros rather than shifting fields" {
  # Three lines back (one key unknown): treating them positionally would read a
  # limit as a count. Zeros mean OK, never a fabricated percentage.
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
shift
for key in "$@"; do
  case "$key" in
    vm.compressor.pages_compressed) echo 620 ;;
    vm.compressor.pages_compressed_limit) echo 1000 ;;
    vm.compressor.segment.total) echo 900 ;;
  esac
done
EOF
  lib mem_compressor_raw
  [ "$output" = "0 0 0 0" ]
  lib mem_state
  [ "$output" = "OK" ]
}

# --- swap parsing (M and G units) ------------------------------------------

@test "swap used parses megabyte token to integer MB" {
  FAKE_SWAP=3109.69M lib mem_swap_used_mb
  [ "$output" = "3109" ]
}

@test "swap used parses gigabyte token to MB" {
  FAKE_SWAP=1.50G lib mem_swap_used_mb
  [ "$output" = "1536" ]
}

@test "swap human renders gigabytes with one decimal" {
  FAKE_SWAP=2662.40M lib mem_swap_human
  [ "$output" = "2.6G" ]
}

@test "absent sysctls (non-macOS) read zero swap, zero fill and OK" {
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  lib mem_swap_used_mb
  [ "$output" = "0" ]
  lib mem_compressor_pcts
  [ "$output" = "0 0" ]
  lib mem_state
  [ "$output" = "OK" ]
  lib mem_token
  [ "$output" = "0%" ]
}

# --- colour + glyph vocabulary ---------------------------------------------

@test "each state maps to its catppuccin colour" {
  lib 'mem_state_colour OK'
  [ "$output" = "a6e3a1" ]
  lib 'mem_state_colour BUSY'
  [ "$output" = "f9e2af" ]
  lib 'mem_state_colour CRITICAL'
  [ "$output" = "f38ba8" ]
}

@test "each state maps to a distinct glyph shape" {
  lib 'mem_state_glyph OK'
  ok="$output"
  lib 'mem_state_glyph BUSY'
  busy="$output"
  lib 'mem_state_glyph CRITICAL'
  crit="$output"
  [ "$ok" != "$busy" ]
  [ "$busy" != "$crit" ]
  [ "$ok" != "$crit" ]
}

# --- footprint parsing (KB/MB/GB) ------------------------------------------

@test "footprint value+unit normalises to MB" {
  lib 'mem_parse_mb 509 MB'
  [ "$output" = "509" ]
  lib 'mem_parse_mb 2 GB'
  [ "$output" = "2048" ]
  lib 'mem_parse_mb 2048 KB'
  [ "$output" = "2" ]
}

@test "per-process footprint reads MB from footprint(1)" {
  FAKE_FP="3200 MB" lib 'mem_footprint_mb 123'
  [ "$output" = "3200" ]
}

@test "footprint of a vanished process is zero" {
  write_stub footprint <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  lib 'mem_footprint_mb 123'
  [ "$output" = "0" ]
}

# --- app name (group key) --------------------------------------------------

@test "nested .app helper bundles roll up to the outer app" {
  lib 'mem_app_name "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)"'
  [ "$output" = "Google Chrome" ]
}

@test "non-bundled process keys on the executable basename" {
  lib 'mem_app_name "/opt/homebrew/bin/node /Users/x/.local/bin/claude"'
  [ "$output" = "node" ]
}

# --- app grouping aggregation ----------------------------------------------

@test "grouping sums footprint and counts procs per app, ranked desc" {
  run bash -c "source '$MEM_LIB'; printf '100\tChrome\n50\tChrome\n300\tnode\n' | mem_group_apps"
  [ "${lines[0]}" = "$(printf '300\t1\tnode')" ]
  [ "${lines[1]}" = "$(printf '150\t2\tChrome')" ]
}

@test "grouping ignores tab-less / empty-app rows" {
  # A malformed line (no tab → empty app) must not form a spurious bucket.
  run bash -c "source '$MEM_LIB'; printf '100\tChrome\nmb=508\n50\tChrome\n' | mem_group_apps"
  [ "${#lines[@]}" -eq 1 ]
  [ "${lines[0]}" = "$(printf '150\t2\tChrome')" ]
}

# --- magnitude bar ----------------------------------------------------------

@test "bar fills proportionally and clamps to width" {
  lib 'mem_bar 5 10 10'
  [ "$output" = "▓▓▓▓▓░░░░░" ]
  lib 'mem_bar 20 10 6'
  [ "$output" = "▓▓▓▓▓▓" ]
}
