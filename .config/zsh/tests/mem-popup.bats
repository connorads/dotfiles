#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MEM_POPUP="$HOME/.config/tmux/scripts/mem-popup.sh"

setup() {
  setup_test_home

  # Multi-key loop form (the lib gathers several keys in one fork). Idle
  # defaults: normal pressure, slots 26% / segments 27% against limits of 1000,
  # real page and segment-buffer sizes (FAKE_PAGESIZE / FAKE_SEGBYTES override).
  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
shift
for key in "$@"; do
  case "$key" in
    kern.memorystatus_vm_pressure_level) echo "${FAKE_PRESSURE:-1}" ;;
    vm.swapusage) echo "total = 4096.00M  used = ${FAKE_SWAP:-0.00M}  free = 4096.00M  (encrypted)" ;;
    vm.compressor.pages_compressed) echo "${FAKE_SLOTS:-260}" ;;
    vm.compressor.pages_compressed_limit) echo 1000 ;;
    vm.compressor.segment.total) echo "${FAKE_SEGS:-270}" ;;
    vm.compressor.segment.limit) echo 1000 ;;
    hw.pagesize) echo "${FAKE_PAGESIZE:-16384}" ;;
    vm.compressor_segment_buffer_size) echo "${FAKE_SEGBYTES:-65536}" ;;
  esac
done
EOF

  write_stub vm_stat <<'EOF'
#!/usr/bin/env bash
cat <<'OUT'
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages wired down: 0.
Pages occupied by compressor: 0.
OUT
EOF

  write_stub footprint <<'EOF'
#!/usr/bin/env bash
pid="${2:-0}"
printf '    phys_footprint: %s MB\n' "${pid:-0}"
EOF

  write_stub ps <<'EOF'
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
EOF

  write_stub tmux <<'EOF'
#!/usr/bin/env bash
if [ "$1" = list-panes ]; then
  printf '%s\n' "${TMUX_PANES:-}"
fi
EOF
}

@test "_one preserves app, pid and command context for termination" {
  run "$MEM_POPUP" _one 6

  [ "$status" -eq 0 ]
  [ "$output" = $'6\tApp6\t6\t/Applications/App6.app/Contents/MacOS/App6' ]
}

@test "summary bounds contributors to five and advertises the detail path" {
  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  [[ "$output" == *"App6"* ]]
  [[ "$output" == *"App2"* ]]
  [[ "$output" != *"App1"* ]]
  [[ "$output" == *"[a] all sampled apps"* ]]
  [[ "$output" == *"[k] manage process"* ]]
  [[ "$output" == *"[h] hibernate agents"* ]]
  [[ "$output" == *"Agent auto-hibernate  observe"* ]]
}

# plain — the summary with its ANSI colour stripped, so the arm rows can be
# asserted as exact strings.
plain() {
  printf '%s\n' "$output" | sed $'s/\x1b\\[[0-9;]*m//g'
}

@test "header renders both arms as marked bars with the distance to the next line and the ratio" {
  # One GiB "pages" and "segments" make the sizes read as the raw counts.
  export FAKE_SLOTS=770 FAKE_SEGS=100 FAKE_PAGESIZE=1073741824 FAKE_SEGBYTES=1073741824

  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  text=$(plain)
  [[ "$text" == *"⊟ BUSY  Memory   pressure 1/4   wired 0M"* ]] || false
  [[ "$text" == *"⊟ Slots  ▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓░│░░░░   77%  3 to red     770.0 of 1000.0 GiB"* ]] || false
  [[ "$text" == *"⬡ Segs   ▓▓░░░░░░░░░░░░│░░░│░░░   10%  60 to amber  100.0 of 1000.0 GiB"* ]] || false
  [[ "$text" == *"Ratio    7.7 pages per segment (limits 1.0): slots fill first"* ]] || false
}

@test "each arm is coloured by its own standing, not the overall state" {
  export FAKE_SLOTS=770

  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  # amber glyph on the slots row, green on the segments row
  [[ "$output" == *$'\e[38;2;249;226;175m⊟\e[0m Slots'* ]] || false
  [[ "$output" == *$'\e[38;2;166;227;161m⬡\e[0m Segs'* ]] || false
}

@test "header glosses each arm with what lowers it, swap beside segments, wired on the state line" {
  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  text=$(plain)
  [[ "$text" == *"⬡ OK  Memory   pressure 1/4   wired 0M"* ]] || false
  [[ "$text" == *"pages held; fall only when the owning process frees or exits"* ]] || false
  [[ "$text" == *"storage held; also falls by swapout   swap 0M of 4.0G"* ]] || false
  [[ "$text" != *"Compressed"* ]]
}

@test "warn pressure is marked on the state line without changing the state" {
  export FAKE_PRESSURE=2

  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  text=$(plain)
  [[ "$text" == *"⬡ OK  Memory   pressure 2/4 ▲ warn   wired 0M"* ]] || false
}

@test "critical pressure is marked and makes the state CRITICAL" {
  export FAKE_PRESSURE=4

  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  text=$(plain)
  [[ "$text" == *"⊠ CRITICAL  Memory   pressure 4/4 ▲ critical   wired 0M"* ]] || false
}

@test "the action line names the heaviest idle or done pane h would stop first" {
  export TMUX_PANES=$'idle\tclaude\t\tapi\tdev:1.0\t100\t%10\nworking\tclaude\tbusy\tworker\tdev:2.0\t200\t%20\ndone\tcodex\tother\tweb\tdev:3.0\t300\t%30\ndone\tclaude\tbatch\tjobs\tdev:4.0\t200\t%40'

  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  [[ "$output" == *"Action   [h] hibernate other (done, 300M) frees its pages from both arms"* ]] || false
}

@test "the action line falls back to k when no pane is safe to hibernate" {
  run "$MEM_POPUP" _summary

  [ "$status" -eq 0 ]
  [[ "$output" == *"Action   no idle or done agent pane; [k] ends a process (frees both arms)"* ]] || false
}

@test "hibernate candidates include safe Claude and Codex panes and rank by footprint" {
  export TMUX_PANES=$'idle\tclaude\t\tapi\tdev:1.0\t100\t%10\nworking\tclaude\tbusy\tworker\tdev:2.0\t200\t%20\ndone\tcodex\tother\tweb\tdev:3.0\t300\t%30\ndone\tclaude\tbatch\tjobs\tdev:4.0\t200\t%40'

  run "$MEM_POPUP" _hibernate_rows

  [ "$status" -eq 0 ]
  [ "$output" = $'%30\t300\tother\tdone\tdev:3.0\n%40\t201\tbatch\tdone\tdev:4.0\n%10\t101\tapi\tidle\tdev:1.0' ]
}

@test "batch hibernate confirms multiple panes, continues after refusal, and summarises" {
  export HIBERNATE_LOG="$BATS_TEST_TMPDIR/hibernate.log"
  write_executable "$BATS_TEST_TMPDIR/hibernate" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$HIBERNATE_LOG"
[ "$2" != %20 ] || exit 6
EOF
  export AGENT_HIBERNATE_SH="$BATS_TEST_TMPDIR/hibernate"

  run bash -c "printf 'y\\n' | '$MEM_POPUP' _hibernate_apply %10 %20 %30"

  [ "$status" -eq 0 ]
  [ "$(cat "$HIBERNATE_LOG")" = $'hibernate %10\nhibernate %20\nhibernate %30' ]
  [[ "$output" == *"Hibernate 3 agent panes?"* ]]
  [[ "$output" == *"2 hibernated, 1 refused, 0 failed"* ]]
}

@test "single-pane hibernate needs no confirmation" {
  export HIBERNATE_LOG="$BATS_TEST_TMPDIR/hibernate.log"
  write_executable "$BATS_TEST_TMPDIR/hibernate" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$HIBERNATE_LOG"
EOF
  export AGENT_HIBERNATE_SH="$BATS_TEST_TMPDIR/hibernate"

  run "$MEM_POPUP" _hibernate_apply %10

  [ "$status" -eq 0 ]
  [[ "$output" != *"Hibernate 1 Claude pane"* ]]
  [[ "$output" == *"1 hibernated, 0 refused, 0 failed"* ]]
}
