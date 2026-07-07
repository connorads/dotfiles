#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

CTX="$BATS_TEST_DIRNAME/../../tmux/scripts/context-menu.sh"
LIB="$BATS_TEST_DIRNAME/../../tmux/scripts/agent-state-lib.sh"

# shellcheck disable=SC1090
. "$LIB"

setup() {
  setup_test_home
  # tmux stub: logs every invocation; answers the pane-info display-message.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "display-message" ]; then
  printf '/dev/ttys010\tzsh\t/tmp/some where\n'
fi
EOF
}

@test "pane menu shows at the click position with the core items" {
  run "$CTX" pane "%5" 10 2

  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "-x 10 -y 2" "$TEST_LOG"
  grep -q -- "resize-pane -Z -t %5" "$TEST_LOG"
  grep -q -- "select-pane -m -t %5" "$TEST_LOG"
  grep -q "copy-pane-info.sh %5 /dev/ttys010 zsh '/tmp/some where'" "$TEST_LOG"
  grep -q 'zed .*/tmp/some where' "$TEST_LOG"
  grep -q 'code .*/tmp/some where' "$TEST_LOG"
  grep -q "claude-watch %5" "$TEST_LOG"
}

@test "pane menu carries the agent-dot items with canonical glyphs" {
  run "$CTX" pane "%5" 10 2

  [ "$status" -eq 0 ]
  for pair in "working:working" "blocked:blocked" "unread:done" "idle:idle"; do
    verb=${pair%:*}
    state=${pair#*:}
    grep -qF "#[fg=#$(agent_hex "$state")]$(agent_char "$state")" "$TEST_LOG"
    grep -q "AGENT_STATE_PANE=%5 .*agent-state.sh $verb" "$TEST_LOG"
  done
  grep -q "AGENT_STATE_PANE=%5 .*agent-state.sh clear" "$TEST_LOG"
}

@test "session menu carries the pickers, layouts, memory popup and detach" {
  run "$CTX" session 7 0

  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "-x 7 -y 0" "$TEST_LOG"
  grep -q "Switch session" "$TEST_LOG"
  grep -q "Switch window" "$TEST_LOG"
  grep -q "header='Layout'" "$TEST_LOG"
  grep -q "mem-popup.sh" "$TEST_LOG"
  grep -q "detach-client" "$TEST_LOG"
}

@test "unknown subcommand fails with usage" {
  run --separate-stderr "$CTX" bogus

  [ "$status" -eq 1 ]
  [[ "$stderr" == *"usage:"* ]]
}
