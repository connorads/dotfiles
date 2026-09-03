#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MEM_POPUP="$HOME/.config/tmux/scripts/mem-popup.sh"

setup() {
  setup_test_home

  write_stub sysctl <<'EOF'
#!/usr/bin/env bash
case "$2" in
  kern.memorystatus_vm_pressure_level) echo 1 ;;
  vm.swapusage) echo 'total = 4096.00M  used = 0.00M  free = 4096.00M  (encrypted)' ;;
esac
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
