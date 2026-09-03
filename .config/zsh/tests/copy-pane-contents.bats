#!/usr/bin/env bats
# Behaviour of copy-pane-contents.sh: capture all retained pane text as logical
# lines, copy the same bytes to the tmux buffer and client clipboard, and report
# what was copied.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

SCRIPT="$BATS_TEST_DIRNAME/../../tmux/scripts/copy-pane-contents.sh"

setup() {
  setup_test_home
  REAL_TMUX="$(command -v tmux)"
  export REAL_TMUX
  SOCK="copy_pane_${BATS_TEST_NUMBER}_$$"
  export SOCK

  write_stub tmux <<'EOF'
#!/usr/bin/env bash
exec "$REAL_TMUX" -L "$SOCK" "$@"
EOF

  mkdir -p "$BATS_TEST_TMPDIR/scripts"
  cp "$SCRIPT" "$BATS_TEST_TMPDIR/scripts/copy-pane-contents.sh"
  cat >"$BATS_TEST_TMPDIR/scripts/osc52-copy-to-client.sh" <<'EOF'
#!/bin/sh
cat >"$OSC52_CAPTURE"
EOF
  chmod +x "$BATS_TEST_TMPDIR/scripts/osc52-copy-to-client.sh"
  TEST_SCRIPT="$BATS_TEST_TMPDIR/scripts/copy-pane-contents.sh"
  OSC52_CAPTURE="$BATS_TEST_TMPDIR/clipboard"
  export OSC52_CAPTURE
}

teardown() {
  stop_private_server
}

@test "copies retained history and screen as joined logical lines" {
  "$REAL_TMUX" -L "$SOCK" -f /dev/null new-session -d -s s -x 10 -y 5 \
    "sh -c 'printf \"history-one\\n\\n123456789012345\\nend\\n\"; exec sleep 1000'"
  pane="$("$REAL_TMUX" -L "$SOCK" display-message -p -t s '#{pane_id}')"
  # wait_until expands pane inside its evaluation shell.
  # shellcheck disable=SC2016
  wait_until 'tmux capture-pane -p -J -S - -t "$pane" | grep -q end'

  run "$TEST_SCRIPT" "$pane"

  [ "$status" -eq 0 ]
  expected=$'history-one\n\n123456789012345\nend'
  [ "$(tmux save-buffer -)" = "$expected" ]
  [ "$(cat "$OSC52_CAPTURE")" = "$expected" ]
  tmux show-messages | grep -F "command: display-message -l \"Copied $pane · 4 lines\""
}

@test "an empty pane reports nothing to copy without replacing the buffer" {
  "$REAL_TMUX" -L "$SOCK" -f /dev/null new-session -d -s s -x 10 -y 5 "sleep 1000"
  pane="$("$REAL_TMUX" -L "$SOCK" display-message -p -t s '#{pane_id}')"
  printf 'keep-me' | tmux load-buffer -

  run "$TEST_SCRIPT" "$pane"

  [ "$status" -eq 0 ]
  [ "$(tmux save-buffer -)" = "keep-me" ]
  [ ! -e "$OSC52_CAPTURE" ]
  tmux show-messages | grep -F "Nothing to copy · $pane is empty"
}

@test "a missing pane fails visibly without replacing the buffer" {
  "$REAL_TMUX" -L "$SOCK" -f /dev/null new-session -d -s s "sleep 1000"
  printf 'keep-me' | tmux load-buffer -

  run "$TEST_SCRIPT" "%99999"

  [ "$status" -eq 1 ]
  [ "$(tmux save-buffer -)" = "keep-me" ]
  tmux show-messages | grep -F "Copy %99999 failed · pane unavailable"
}
