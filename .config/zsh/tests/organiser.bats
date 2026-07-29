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
    *window_linked*)
      if [ -n "${TMUX_WINDOW_INFO:-}" ]; then printf '%s\n' "$TMUX_WINDOW_INFO"; else printf '$1\tsource @name\t@7\t1\twin ##{x}\t0\t1\t2\n'; fi
      ;;
    *window_panes*)
      if [ -n "${TMUX_PANE_INFO:-}" ]; then printf '%s\n' "$TMUX_PANE_INFO"; else printf '$1\tsource @name\t@7\t%%5\t2\t2\t/dev/ttys010\tzsh\t/tmp/has space\n'; fi
      ;;
    *'#{session_id}	#{window_id}'*) printf '$2	@8\n' ;;
    *'#{session_id}	#{session_name}	#{window_id}	#{window_panes}	#{session_windows}'*) printf '%s\n' "${TMUX_MARKED_SOURCE_INFO:-$9	marked	@9	2	2}" ;;
  esac
elif [ "$1" = "list-sessions" ]; then
  if [ -n "${TMUX_SESSIONS:-}" ]; then printf '%b' "$TMUX_SESSIONS"; else printf '$1\tsource @name\n$2\tdest one\n$3\tdest two\n'; fi
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

@test "window destination menu filters source and sessions already containing a shared window" {
  run "$ORG" window-dest share clientA "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'dest one' "$TEST_LOG"
  ! grep -q 'source @name' "$TEST_LOG"
  ! grep -q 'dest two' "$TEST_LOG"
}

@test "window destination menu pages to client height with next control" {
  export TMUX_CLIENT_HEIGHT=12
  export TMUX_SESSIONS='$1	src\n$2	a\n$3	b\n$4	c\n$5	d\n$6	e\n$7	f\n$8	g\n'

  run "$ORG" window-dest move-follow clientA "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'Next >' "$TEST_LOG"
  grep -q 'session 1/2' "$TEST_LOG"
}

@test "window destination commands shell-quote multi-digit session IDs" {
  export TMUX_SESSIONS='$1\tsrc\n$13\tdest\n'

  run "$ORG" window-dest move-background "client one" "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'action-window' 'move-background' 'client one' '@7' '\$13'" "$TEST_LOG"
}

@test "pane destination commands shell-quote multi-digit session IDs" {
  export TMUX_SESSIONS='$1\tsrc\n$13\tdest\n'

  run "$ORG" pane-dest break-background "client one" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'action-pane-break' 'break-background' 'client one' '%5' '\$13'" "$TEST_LOG"
}

@test "paging commands preserve client names and tmux IDs" {
  export TMUX_CLIENT_HEIGHT=12
  export TMUX_SESSIONS='$1\tsrc\n$2\ta\n$3\tb\n$4\tc\n$5\td\n$6\te\n$7\tf\n$13\tg\n'

  run "$ORG" window-dest move-follow "client one's" "@7" "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -Fq "'window-dest' 'move-follow' 'client one'\\\\''s' '@7' '%5' '1' '2' '1'" "$TEST_LOG"
}

@test "window menu uses IDs for commands and escaped names only for labels" {
  export TMUX_WINDOW_INFO='$1	source	@7	1	win #{danger}	0	1	2'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  grep -q 'Window · win ##{danger}' "$TEST_LOG"
  grep -q 'rename-window -t @7' "$TEST_LOG"
  ! grep -q 'rename-window -t win' "$TEST_LOG"
}

@test "the rename prompt takes a label, not a comma-split list" {
  export TMUX_WINDOW_INFO='$1	source	@7	1	notes, drafts	0	1	2'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  # `command-prompt` splits -I and -p on commas into a sequence of prompts, so a
  # label holding one would ask twice and pre-fill neither half. `-l` is literal.
  line=$(grep -m1 'command-prompt' "$TEST_LOG")
  [ -n "$line" ]
  [[ "$line" == *" -l "* ]]
}

@test "linked window menu relabels kill and enables unlink" {
  export TMUX_WINDOW_INFO='$1	source	@7	1	shared	1	2	3'

  run "$ORG" window clientA "@7" "%5" "/tmp/has space" 9 3

  [ "$status" -eq 0 ]
  grep -q 'Remove from this session' "$TEST_LOG"
  grep -q 'Kill shared window everywhere' "$TEST_LOG"
}

@test "move follow confirms when it closes the source session" {
  export TMUX_WINDOW_INFO='$1	source	@7	1	only	0	1	1'

  run "$ORG" action-window move-follow clientA "@7" '$2'

  [ "$status" -eq 0 ]
  grep -q 'confirm-before -p move only and close source' "$TEST_LOG"
}

@test "pane break is disabled for a sole pane" {
  export TMUX_PANE_INFO='$1	source	@7	%5	1	2	/dev/ttys010	zsh	/tmp'

  run "$ORG" pane-dest break-follow clientA "%5" 1 2 0

  [ "$status" -eq 0 ]
  grep -q 'Break disabled: pane is already the only pane' "$TEST_LOG"
}

@test "pane menu shows four marked-pane join directions from another window" {
  export TMUX_MARKED='1	$9	marked	@9	%9	2	2\n'

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
