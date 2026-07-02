#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

setup() {
  setup_test_home
  export SOURCE_FILE_CAPTURE="$BATS_TEST_TMPDIR/wrapped.tmux"
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "show-options -gv prefix")
    echo C-b
    ;;
  "list-keys -N -T prefix")
    # Current tmux prefixes each -N line with the client key-prefix ("C-b ").
    cat <<'NOTES'
C-b g       Lazygit
C-b M-s     Skill loader (skl)
C-b C-Up    Resize pane up
C-b \      Join pane from picker (left/right)
NOTES
    ;;
  "list-keys -T prefix")
    cat <<'KEYS'
bind-key    -T prefix g       display-popup -E -d "#{pane_current_path}" -h "98%" -w "98%" "zsh -ic \"lazygit\""
bind-key    -T prefix M-s     display-popup -E -h "90%" -w "90%" /Users/connorads/.config/skl/bin/pick
bind-key -r -T prefix C-Up    resize-pane -U
bind-key    -T prefix \\      choose-tree -Zw "join-pane -h -s '%%'"
bind-key    -T prefix z       run-shell -b "sh /Users/connorads/.config/tmux/scripts/track-bind.sh z zoom #{session_name} #{window_index} #{pane_index} #{pane_current_path} #{host_short}" \; resize-pane -Z
KEYS
    ;;
  source-file*)
    cp "$2" "$SOURCE_FILE_CAPTURE"
    ;;
  *)
    echo "unexpected tmux args: $*" >&2
    exit 64
    ;;
esac
EOF
}

@test "wrap-track wraps padded non-repeat prefix bindings" {
  run sh "$TESTS_DIR/../../tmux/scripts/wrap-track.sh"
  [ "$status" -eq 0 ]

  [ -f "$SOURCE_FILE_CAPTURE" ]
  grep -F 'bind-key -N "Lazygit" -T prefix g run-shell -b' "$SOURCE_FILE_CAPTURE"
  grep -F '/.config/tmux/scripts/track-bind.sh g lazygit #{q:session_name}' "$SOURCE_FILE_CAPTURE"
  grep -F '#{q:pane_current_path} #{q:host_short}' "$SOURCE_FILE_CAPTURE"
  grep -F 'display-popup -E -d "#{pane_current_path}" -h "98%" -w "98%" "zsh -ic \"lazygit\""' "$SOURCE_FILE_CAPTURE"
}

@test "wrap-track preserves repeat flag and notes" {
  run sh "$TESTS_DIR/../../tmux/scripts/wrap-track.sh"
  [ "$status" -eq 0 ]

  grep -F 'bind-key -N "Resize pane up" -r -T prefix C-Up run-shell -b' "$SOURCE_FILE_CAPTURE"
  grep -F '/.config/tmux/scripts/track-bind.sh C-Up resize-pane-up #{q:session_name}' "$SOURCE_FILE_CAPTURE"
  grep -F '\; resize-pane -U' "$SOURCE_FILE_CAPTURE"
}

@test "wrap-track handles backslash keys and refreshes already wrapped bindings" {
  run sh "$TESTS_DIR/../../tmux/scripts/wrap-track.sh"
  [ "$status" -eq 0 ]

  grep -F 'bind-key -N "Join pane from picker (left/right)" -T prefix \\ run-shell -b' "$SOURCE_FILE_CAPTURE"
  [ "$(grep -c 'track-bind.sh' "$SOURCE_FILE_CAPTURE")" -eq 5 ]
  grep -F 'bind-key -T prefix z run-shell -b' "$SOURCE_FILE_CAPTURE"
  grep -F '#{q:pane_current_path} #{q:host_short}' "$SOURCE_FILE_CAPTURE"
  grep -F 'resize-pane -Z' "$SOURCE_FILE_CAPTURE"
}

@test "wrap-track preserves notes on older tmux without the key-prefix column" {
  # Older tmux omits the leading "C-b " on -N lines; the guard must leave them be.
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "show-options -gv prefix")
    echo C-b
    ;;
  "list-keys -N -T prefix")
    echo 'g       Lazygit'
    ;;
  "list-keys -T prefix")
    echo 'bind-key    -T prefix g       display-message hi'
    ;;
  source-file*)
    cp "$2" "$SOURCE_FILE_CAPTURE"
    ;;
  *)
    echo "unexpected tmux args: $*" >&2
    exit 64
    ;;
esac
EOF

  run sh "$TESTS_DIR/../../tmux/scripts/wrap-track.sh"
  [ "$status" -eq 0 ]

  grep -F 'bind-key -N "Lazygit" -T prefix g run-shell -b' "$SOURCE_FILE_CAPTURE"
  grep -F 'track-bind.sh g lazygit #{q:session_name}' "$SOURCE_FILE_CAPTURE"
}
