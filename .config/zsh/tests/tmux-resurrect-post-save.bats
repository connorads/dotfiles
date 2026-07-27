#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

REAL_POST_SAVE="$BATS_TEST_DIRNAME/../../tmux/scripts/resurrect-post-save.sh"
# bash >= 5, not Apple's 3.2 - see the note in tmux-resurrect-sessions.bats.
REAL_BASH="$BASH5"

setup() {
  setup_test_home
  SCRIPT_DIR="$HOME/.config/tmux/scripts"
  POST_SAVE="$SCRIPT_DIR/resurrect-post-save.sh"
  SAVE_FILE="$HOME/.local/share/tmux/resurrect/save.txt"
  POST_SAVE_LOG="$HOME/.cache/tmux-resurrect-post-save.log"
  mkdir -p "$SCRIPT_DIR" "$(dirname "$SAVE_FILE")"
  cp "$REAL_POST_SAVE" "$POST_SAVE"
  chmod +x "$POST_SAVE"
  touch "$SAVE_FILE"
}

write_child() {
  local name=$1
  shift

  write_executable "$SCRIPT_DIR/$name" "$@"
}

# extract_preamble FILE — the bash5 re-exec preamble block, verbatim from a real
# script, so a stub child exercises the shipped text and not a hand-copy of it.
extract_preamble() {
  sed -n '/^# --- bash5 re-exec preamble/,/^# --- end bash5 preamble ---$/p' "$1"
}

@test "post-save hook runs both maintenance scripts on the happy path" {
  write_child resurrect-strip-nix-paths.sh <<'EOF'
#!/usr/bin/env bash
printf 'strip:%s\n' "$1" >>"$TEST_LOG"
EOF
  write_child resurrect-save-sessions.sh <<'EOF'
#!/usr/bin/env bash
printf 'sessions:%s\n' "$1" >>"$TEST_LOG"
EOF

  run "$REAL_BASH" "$POST_SAVE" "$SAVE_FILE"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "$(printf 'strip:%s\nsessions:%s\n' "$SAVE_FILE" "$SAVE_FILE")" ]
}

@test "post-save hook still saves sessions when path stripping fails" {
  write_child resurrect-strip-nix-paths.sh <<'EOF'
#!/usr/bin/env bash
printf 'strip:%s\n' "$1" >>"$TEST_LOG"
exit 7
EOF
  write_child resurrect-save-sessions.sh <<'EOF'
#!/usr/bin/env bash
printf 'sessions:%s\n' "$1" >>"$TEST_LOG"
EOF

  run "$REAL_BASH" "$POST_SAVE" "$SAVE_FILE"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "$(printf 'strip:%s\nsessions:%s\n' "$SAVE_FILE" "$SAVE_FILE")" ]
  run grep -F "resurrect-strip-nix-paths.sh failed rc=7" "$POST_SAVE_LOG"
  [ "$status" -eq 0 ]
}

@test "post-save hook logs a session-save failure without failing resurrect save" {
  write_child resurrect-strip-nix-paths.sh <<'EOF'
#!/usr/bin/env bash
printf 'strip:%s\n' "$1" >>"$TEST_LOG"
EOF
  write_child resurrect-save-sessions.sh <<'EOF'
#!/usr/bin/env bash
printf 'sessions:%s\n' "$1" >>"$TEST_LOG"
exit 9
EOF

  run "$REAL_BASH" "$POST_SAVE" "$SAVE_FILE"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "$(printf 'strip:%s\nsessions:%s\n' "$SAVE_FILE" "$SAVE_FILE")" ]
  run grep -F "resurrect-save-sessions.sh failed rc=9" "$POST_SAVE_LOG"
  [ "$status" -eq 0 ]
}

@test "post-save hook logs missing or invalid save-file arguments" {
  run "$REAL_BASH" "$POST_SAVE"

  [ "$status" -eq 0 ]
  run grep -F "missing save file path" "$POST_SAVE_LOG"
  [ "$status" -eq 0 ]

  : >"$TEST_LOG"
  : >"$POST_SAVE_LOG"
  run "$REAL_BASH" "$POST_SAVE" "$HOME/.local/share/tmux/resurrect/missing.txt"

  [ "$status" -eq 0 ]
  [ ! -s "$TEST_LOG" ]
  run grep -F "save file does not exist" "$POST_SAVE_LOG"
  [ "$status" -eq 0 ]
}

@test "post-save hook does not suppress its child's own bash5 re-exec" {
  # The re-exec guard must NOT be inherited. post-save re-execs itself under
  # bash 5, then run_step spawns save-sessions as a *child process* whose
  # `#!/usr/bin/env bash` still resolves to the old bash tmux hands it. If that
  # child sees TMUX_BASH5_REEXEC=1 it skips its own re-exec and dies under 3.2 -
  # and run_step only logs a warning, so the whole thing fails silently.
  local old_bash=/bin/bash
  [ -x "$old_bash" ] || skip "no $old_bash to act as the too-old interpreter"
  [ "$("$old_bash" -c 'echo ${BASH_VERSINFO[0]}')" -lt 5 ] || skip "$old_bash is already bash >= 5"

  write_child resurrect-strip-nix-paths.sh <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  {
    printf '#!/usr/bin/env bash\n'
    extract_preamble "$REAL_POST_SAVE"
    cat <<'EOF'
printf 'child-major:%s\n' "${BASH_VERSINFO[0]}" >>"$TEST_LOG"
EOF
  } >"$SCRIPT_DIR/resurrect-save-sessions.sh"
  chmod +x "$SCRIPT_DIR/resurrect-save-sessions.sh"

  # A PATH carrying no bash >= 5, so the child's `env bash` lands on the old one
  # - exactly the situation tmux's run-shell creates.
  PATH="/usr/bin:/bin" run "$old_bash" "$POST_SAVE" "$SAVE_FILE"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "child-major:5" ]
  [ ! -s "$POST_SAVE_LOG" ]
}
