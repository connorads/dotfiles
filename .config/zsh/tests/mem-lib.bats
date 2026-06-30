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

  # sysctl shim driven by env: FAKE_PRESSURE for the pressure level, FAKE_SWAP
  # for the literal vm.swapusage "used = …" token (e.g. 3109.69M, 1.50G).
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
case "$2" in
  kern.memorystatus_vm_pressure_level) echo "${FAKE_PRESSURE:-1}" ;;
  vm.swapusage) echo "total = 4096.00M  used = ${FAKE_SWAP:-0.00M}  free = 100.00M  (encrypted)" ;;
esac
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

# --- mem_state mapping across (pressure, swap) -----------------------------

@test "OK when pressure normal and swap below the BUSY threshold" {
  FAKE_PRESSURE=1 FAKE_SWAP=500.00M lib mem_state
  [ "$output" = "OK" ]
}

@test "BUSY on warn pressure even with no swap" {
  FAKE_PRESSURE=2 FAKE_SWAP=0.00M lib mem_state
  [ "$output" = "BUSY" ]
}

@test "BUSY on swap over the 5G (5120 MB) threshold even when pressure reads normal" {
  FAKE_PRESSURE=1 FAKE_SWAP=6000.00M lib mem_state
  [ "$output" = "BUSY" ]
}

@test "CRITICAL on critical pressure level" {
  FAKE_PRESSURE=4 FAKE_SWAP=0.00M lib mem_state
  [ "$output" = "CRITICAL" ]
}

@test "CRITICAL on large swap regardless of pressure" {
  FAKE_PRESSURE=1 FAKE_SWAP=8000.00M lib mem_state
  [ "$output" = "CRITICAL" ]
}

# --- BUSY swap-line raise to 5120: the resting band no longer trips amber ------

@test "swap in the idle band (5000 MB, below 5120) reads OK at normal pressure" {
  FAKE_PRESSURE=1 FAKE_SWAP=5000.00M lib mem_state
  [ "$output" = "OK" ]
}

@test "swap exactly at the 5120 MB line reads BUSY" {
  FAKE_PRESSURE=1 FAKE_SWAP=5120.00M lib mem_state
  [ "$output" = "BUSY" ]
}

# --- mem_cause: which signal drives the active state -----------------------

@test "cause none when OK" {
  FAKE_PRESSURE=1 FAKE_SWAP=500.00M lib mem_cause
  [ "$output" = "none" ]
}

@test "cause pressure on warn pressure with no swap" {
  FAKE_PRESSURE=2 FAKE_SWAP=0.00M lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause pressure on warn pressure with idle-band swap (the bug case)" {
  FAKE_PRESSURE=2 FAKE_SWAP=3000.00M lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause swap when swap drives BUSY at normal pressure" {
  FAKE_PRESSURE=1 FAKE_SWAP=6000.00M lib mem_cause
  [ "$output" = "swap" ]
}

@test "cause pressure on critical pressure level" {
  FAKE_PRESSURE=4 FAKE_SWAP=0.00M lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause swap when swap drives CRITICAL at normal pressure" {
  FAKE_PRESSURE=1 FAKE_SWAP=8000.00M lib mem_cause
  [ "$output" = "swap" ]
}

@test "cause pressure when both fire at BUSY (pressure wins)" {
  FAKE_PRESSURE=2 FAKE_SWAP=6000.00M lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause pressure when both fire at CRITICAL (pressure wins)" {
  FAKE_PRESSURE=4 FAKE_SWAP=8000.00M lib mem_cause
  [ "$output" = "pressure" ]
}

@test "cause swap when CRITICAL via swap but pressure only 2 (active-state-line rule)" {
  # State is CRITICAL (swap >= 7168) but pressure 2 < CRITICAL's line of 4, so
  # swap is the driver, not pressure.
  FAKE_PRESSURE=2 FAKE_SWAP=8000.00M lib mem_cause
  [ "$output" = "swap" ]
}

# --- mem_token: marker when pressure-driven, else swap figure ---------------

@test "token is the cause marker when pressure drives the state" {
  FAKE_PRESSURE=2 FAKE_SWAP=0.00M lib mem_token
  [ "$output" = "▲" ]
}

@test "token is the swap figure when swap drives the state" {
  FAKE_PRESSURE=1 FAKE_SWAP=6000.00M lib mem_token
  [ "$output" = "5.9G" ]
}

@test "token is the swap figure (resting baseline) when OK" {
  FAKE_PRESSURE=1 FAKE_SWAP=2662.40M lib mem_token
  [ "$output" = "2.6G" ]
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

@test "swap absent (non-macOS) reads zero" {
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  lib mem_swap_used_mb
  [ "$output" = "0" ]
  lib mem_state
  [ "$output" = "OK" ]
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
