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
  # tmux stub: logs every invocation; answers the display-message resolutions.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "display-message" ]; then
  case "$*" in
    *pane_tty*) printf '/dev/ttys010\tzsh\t/tmp/some where\n' ;;
    *automatic-rename*) printf '%s\t%s\n' "${TMUX_AUTOMATIC_RENAME:-0}" "${TMUX_VISIBLE_LABEL:-mywin}" ;;
  esac
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

@test "window menu carries swap/rename/kill and agent dots for the active pane" {
  run "$CTX" window "@7" "%5" "/tmp/somewhere" 12 0

  [ "$status" -eq 0 ]
  grep -q "display-menu" "$TEST_LOG"
  grep -q -- "-x 12 -y 0" "$TEST_LOG"
  grep -q -- "swap-window -s @7 -t :-1" "$TEST_LOG"
  grep -q -- "swap-window -s @7 -t :+1" "$TEST_LOG"
  grep -q "rename-window -t @7" "$TEST_LOG"
  grep -q "kill-window -t @7" "$TEST_LOG"
  grep -q "AGENT_STATE_PANE=%5 .*agent-state.sh working" "$TEST_LOG"
}

@test "window menu seeds rename from the auto cwd label" {
  export TMUX_AUTOMATIC_RENAME=1
  export TMUX_VISIBLE_LABEL="auto-project"

  run "$CTX" window "@7" "%5" "/tmp/somewhere" 12 0

  [ "$status" -eq 0 ]
  grep -q 'command-prompt -I "auto-project" -p "Manual window label:" "rename-window -t @7' "$TEST_LOG"
  grep -q "Auto name a set-window-option -t @7 automatic-rename on" "$TEST_LOG"
}

@test "window menu seeds rename from the manual label and resets the clicked window" {
  export TMUX_AUTOMATIC_RENAME=0
  export TMUX_VISIBLE_LABEL="manual label"

  run "$CTX" window "@7" "%5" "/tmp/somewhere" 12 0

  [ "$status" -eq 0 ]
  grep -q 'command-prompt -I "manual label" -p "Manual window label:" "rename-window -t @7' "$TEST_LOG"
  grep -q "Reset name a set-window-option -t @7 automatic-rename on" "$TEST_LOG"
}

@test "window menu outside ~/.trees has no worktree actions" {
  run "$CTX" window "@7" "%5" "/tmp/somewhere" 12 0

  [ "$status" -eq 0 ]
  ! grep -q "wt-publish" "$TEST_LOG"
  ! grep -q "wt-finish" "$TEST_LOG"
  ! grep -q "wt-remove" "$TEST_LOG"
}

@test "window menu for a ~/.trees window adds the three worktree actions" {
  run "$CTX" window "@7" "%5" "$HOME/.trees/repo/topic" 12 0

  [ "$status" -eq 0 ]
  grep -q "wt-publish '$HOME/.trees/repo/topic'" "$TEST_LOG"
  grep -q "wt-finish @7 '$HOME/.trees/repo/topic'" "$TEST_LOG"
  grep -q "wt-remove @7 '$HOME/.trees/repo/topic'" "$TEST_LOG"
}

@test "wt-finish popup mode kills the window only on success" {
  write_stub wt-finish <<'EOF'
#!/usr/bin/env bash
printf 'wt-finish %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-finish "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-finish --mode local /tmp/trees/repo/topic" "$TEST_LOG"
  grep -q -- "kill-window -t @7" "$TEST_LOG"
}

@test "wt-finish popup mode leaves the window open on failure" {
  write_stub wt-finish <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run --separate-stderr "$CTX" wt-finish "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"window left open"* ]]
  ! grep -q "kill-window" "$TEST_LOG"
}

@test "wt-remove popup mode kills the window only on success" {
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-remove "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-remove /tmp/trees/repo/topic" "$TEST_LOG"
  grep -q -- "kill-window -t @7" "$TEST_LOG"
}

@test "wt-remove popup mode leaves the window open on failure" {
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run --separate-stderr "$CTX" wt-remove "@7" "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"window left open"* ]]
  ! grep -q "kill-window" "$TEST_LOG"
}

@test "wt-publish popup mode publishes without touching the window" {
  write_stub wt-publish <<'EOF'
#!/usr/bin/env bash
printf 'wt-publish %s\n' "$*" >>"$TEST_LOG"
exit 0
EOF

  run "$CTX" wt-publish "/tmp/trees/repo/topic" </dev/null
  [ "$status" -eq 0 ]
  grep -q -- "wt-publish --pr /tmp/trees/repo/topic" "$TEST_LOG"
  ! grep -q "kill-window" "$TEST_LOG"
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
