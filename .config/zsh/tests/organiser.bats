#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

ORG="$BATS_TEST_DIRNAME/../../tmux/scripts/organiser.sh"

setup() {
  setup_test_home
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$TEST_LOG"
if [ "$1" = "display-message" ]; then
  case "$*" in
    *client_height*) printf '%s\n' "${TMUX_CLIENT_HEIGHT:-14}" ;;
    *'#{@agent_state}'*) printf '%s\n' "${TMUX_AGENT_STATE:-idle}" ;;
    *'#{@agent_kind}'*) printf '%s\n' "${TMUX_AGENT_KIND:-claude}" ;;
    *'#{@agent_hibernate_pinned}'*) printf '%s\n' "${TMUX_AGENT_PINNED:-}" ;;
    *window_linked*)
      if [ -n "${TMUX_WINDOW_INFO:-}" ]; then printf '%s\n' "$TMUX_WINDOW_INFO"; else printf '$1\037source @name\037@7\0371\037win ##{x}\0370\0371\0372\n'; fi
      ;;
    *window_panes*)
      if [ -n "${TMUX_PANE_INFO:-}" ]; then printf '%s\n' "$TMUX_PANE_INFO"; else printf '$1\037source @name\037@7\037%%5\0372\0372\037/dev/ttys010\037zsh\037/tmp/has space\n'; fi
      ;;
    *'#{session_id}'*'#{window_id}'*) printf '$2\037@8\n' ;;
    *'#{session_name}'*'#{window_panes}'*'#{session_windows}'*) printf '%s\n' "${TMUX_MARKED_SOURCE_INFO:-$9marked@922}" ;;
  esac
elif [ "$1" = "list-sessions" ]; then
  if [ -n "${TMUX_SESSIONS:-}" ]; then printf '%b' "$TMUX_SESSIONS"; else printf '$1\037source @name\n$2\037dest one\n$3\037dest two\n'; fi
elif [ "$1" = "list-windows" ]; then
  case "$*" in
    *'$3'*) printf '@7\n' ;;
    *) : ;;
  esac
elif [ "$1" = "list-panes" ]; then
  printf '%b' "${TMUX_MARKED:-}"
fi
EOF
}

@test "pane menu offers hibernate only for a safe Claude pane" {
  export TMUX_AGENT_STATE=idle TMUX_AGENT_KIND=claude

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  grep -q 'hibernate (free RAM)' "$TEST_LOG"
  grep -q 'agent-hibernate-action.sh.*hibernate.*%5.*clientA' "$TEST_LOG"
  ! grep -q 'thaw (resume)' "$TEST_LOG"
}

@test "pane menu explains why a busy Claude pane cannot hibernate" {
  export TMUX_AGENT_STATE=working TMUX_AGENT_KIND=claude

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  grep -q -- '-hibernate (working)' "$TEST_LOG"
  ! grep -q 'agent-hibernate-action.sh.*hibernate' "$TEST_LOG"
}

@test "pane menu gives a parked pane only the thaw lifecycle action" {
  export TMUX_AGENT_STATE=hibernated TMUX_AGENT_KIND=claude

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  grep -q 'thaw (resume)' "$TEST_LOG"
  grep -q 'agent-hibernate-action.sh.*thaw.*%5.*clientA' "$TEST_LOG"
  ! grep -q 'working  ' "$TEST_LOG"
  ! grep -q 'clear dot' "$TEST_LOG"
}

@test "pane menu offers hibernate for a safe Codex pane" {
  export TMUX_AGENT_STATE=idle TMUX_AGENT_KIND=codex

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  grep -q 'hibernate (free RAM)' "$TEST_LOG"
}

@test "pane menu toggles the automatic hibernation pin" {
  export TMUX_AGENT_STATE=idle TMUX_AGENT_KIND=claude

  run "$ORG" pane clientA "%5" 1 2
  [ "$status" -eq 0 ]
  grep -q 'protect from auto-hibernate' "$TEST_LOG"
  grep -q 'agent-autohibernate.sh.*pin.*%5' "$TEST_LOG"

  : >"$TEST_LOG"
  export TMUX_AGENT_PINNED=on
  run "$ORG" pane clientA "%5" 1 2
  grep -q 'allow auto-hibernate' "$TEST_LOG"
  grep -q 'agent-autohibernate.sh.*unpin.*%5' "$TEST_LOG"
}

@test "pane menu omits lifecycle actions for unsupported panes" {
  export TMUX_AGENT_STATE=idle TMUX_AGENT_KIND=opencode

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  ! grep -q 'hibernate (free RAM)' "$TEST_LOG"
  ! grep -q 'thaw (resume)' "$TEST_LOG"
}

@test "window menu never offers pane lifecycle actions" {
  export TMUX_AGENT_STATE=idle TMUX_AGENT_KIND=claude

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  ! grep -q 'hibernate (free RAM)' "$TEST_LOG"
  ! grep -q 'thaw (resume)' "$TEST_LOG"
}

@test "window destination menu filters source and sessions already containing a shared window" {
  run "$ORG" window-dest share clientA "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'dest one' "$TEST_LOG"
  ! grep -q 'source @name' "$TEST_LOG"
  ! grep -q 'dest two' "$TEST_LOG"
}

@test "window destination menu pages to client height with next control" {
  export TMUX_CLIENT_HEIGHT=12
  export TMUX_SESSIONS='$1\037src\n$2\037a\n$3\037b\n$4\037c\n$5\037d\n$6\037e\n$7\037f\n$8\037g\n'

  run "$ORG" window-dest move-follow clientA "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'Next >' "$TEST_LOG"
  grep -q 'session 1/2' "$TEST_LOG"
}

@test "window destination commands shell-quote multi-digit session IDs" {
  export TMUX_SESSIONS='$1\037src\n$13\037dest\n'

  run "$ORG" window-dest move-background "client one" "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'action-window' 'move-background' 'client one' '@7' '\$13'" "$TEST_LOG"
}

@test "pane destination commands shell-quote multi-digit session IDs" {
  export TMUX_SESSIONS='$1\037src\n$13\037dest\n'

  run "$ORG" pane-dest break-background "client one" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'action-pane-break' 'break-background' 'client one' '%5' '\$13'" "$TEST_LOG"
}

@test "paging commands preserve client names and tmux IDs" {
  export TMUX_CLIENT_HEIGHT=12
  export TMUX_SESSIONS='$1\037src\n$2\037a\n$3\037b\n$4\037c\n$5\037d\n$6\037e\n$7\037f\n$13\037g\n'

  run "$ORG" window-dest move-follow "client one's" "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'window-dest' 'move-follow' 'client one'\\\\''s' '@7' '%5' '1' '2' '1'" "$TEST_LOG"
}

@test "window menu uses IDs for commands and escaped names only for labels" {
  export TMUX_WINDOW_INFO=$'$1\037source\037@7\0371\037win #{danger}\0370\0371\0372'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  grep -q 'Window · win ##{danger}' "$TEST_LOG"
  grep -q 'rename-window -t @7' "$TEST_LOG"
  ! grep -q 'rename-window -t win' "$TEST_LOG"
}

@test "the rename prompt takes a label, not a comma-split list" {
  export TMUX_WINDOW_INFO=$'$1\037source\037@7\0371\037notes, drafts\0370\0371\0372'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  # `command-prompt` splits -I and -p on commas into a sequence of prompts, so a
  # label holding one would ask twice and pre-fill neither half. `-l` is literal.
  line=$(grep -m1 'command-prompt' "$TEST_LOG")
  [ -n "$line" ]
  [[ "$line" == *" -l "* ]]
}

@test "linked window menu relabels kill and enables unlink" {
  export TMUX_WINDOW_INFO=$'$1\037source\037@7\0371\037shared\0371\0372\0373'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  grep -q 'Remove from this session' "$TEST_LOG"
  grep -q 'Kill shared window everywhere' "$TEST_LOG"
}

@test "a window whose label is empty is not read as a linked window" {
  # tmux reports an empty #{pane_current_path} for a dead pane held open by
  # remain-on-exit, so #{b:pane_current_path} - the label under
  # automatic-rename, tmux's default - is empty too. Under a tab separator
  # `read` collapsed it: window_linked became the label and
  # window_linked_sessions became window_linked, so an unlinked window offered
  # Unlink and "Kill shared window everywhere" on a menu titled "Window · 0".
  export TMUX_WINDOW_INFO=$'$1\037source\037@7\0371\037\0370\0371\0371'

  run "$ORG" window clientA "@7" "%5" "/tmp" 9 3

  [ "$status" -eq 0 ]
  ! grep -q 'Kill shared window everywhere' "$TEST_LOG"
  ! grep -q 'Remove from this session' "$TEST_LOG"
  ! grep -q 'Window · 0' "$TEST_LOG"
}

@test "move follow confirms when it closes the source session" {
  export TMUX_WINDOW_INFO=$'$1\037source\037@7\0371\037only\0370\0371\0371'

  run "$ORG" action-window move-follow clientA "@7" '$2'

  [ "$status" -eq 0 ]
  grep -q 'confirm-before -p move only and close source' "$TEST_LOG"
}

@test "pane break is disabled for a sole pane" {
  export TMUX_PANE_INFO=$'$1\037source\037@7\037%5\0371\0372\037/dev/ttys010\037zsh\037/tmp'

  run "$ORG" pane-dest break-follow clientA "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'Break disabled: pane is already the only pane' "$TEST_LOG"
}

@test "pane menu shows four marked-pane join directions from another window" {
  # Real bytes, not \037 escapes: the stub renders with printf '%b', where
  # \0372 reads as the single octal \0372, not US followed by a 2.
  export TMUX_MARKED=$'1\037$9\037marked\037@9\037%9\0372\0372\n'

  run "$ORG" pane clientA "%5" 1 2

  [ "$status" -eq 0 ]
  grep -q 'Join marked pane here' "$TEST_LOG"
  grep -Fq "'action-pane-join' 'left' 'clientA' '%9' '%5'" "$TEST_LOG"
  grep -Fq "'action-pane-join' 'right' 'clientA' '%9' '%5'" "$TEST_LOG"
  grep -Fq "'action-pane-join' 'above' 'clientA' '%9' '%5'" "$TEST_LOG"
  grep -Fq "'action-pane-join' 'below' 'clientA' '%9' '%5'" "$TEST_LOG"
}

@test "pane join directions map to join-pane flags and return to destination" {
  run "$ORG" action-pane-join left clientA "%9" "%5"

  [ "$status" -eq 0 ]
  grep -q 'join-pane -h -b -s %9 -t %5' "$TEST_LOG"
  grep -q 'select-pane -t %5' "$TEST_LOG"
}
