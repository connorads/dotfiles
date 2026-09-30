#!/usr/bin/env bats

# The clipboard end of `vox grab`: the key and the pill menu's rows. `vox` is
# stubbed, so this asserts only what the script adds - the clipboard, the
# message, and that it never exits non-zero under run-shell -b.
#
# Not integration-tagged: nothing here starts a server or spends real time.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

GRAB="$HOME/.config/tmux/scripts/vox-grab.sh"

setup() {
  setup_test_home
  write_stub tmux <<'EOF2'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$TEST_LOG"
EOF2
  export VOX_BIN="$HOME/bin/vox"
  mkdir -p "$HOME/bin"
}

# stub_vox RC [STDERR] - a `vox grab` that logs its argv, writes a grab.md
# with a header and two lines, prints the path and exits RC.
stub_vox() {
  cat >"$VOX_BIN" <<EOF2
#!/usr/bin/env bash
printf 'vox %s\n' "\$*" >>"$TEST_LOG"
out="$HOME/grab.md"
printf '# Call in progress: standup\n\n[00:00:00] Me: hello there\n[00:00:02] Them: yes\n' >"\$out"
printf 'vox: transcribing the call so far…\n' >&2
[ -n "${2:-}" ] && printf '%s\n' "${2:-}" >&2
printf '%s\n' "\$out"
exit $1
EOF2
  chmod +x "$VOX_BIN"
}

grab() {
  run env VOX_BIN="$VOX_BIN" TEST_LOG="$TEST_LOG" "$GRAB" "$@"
}

@test "the whole call so far goes to the clipboard, with its word count" {
  stub_vox 0

  grab

  [ "$status" -eq 0 ]
  grep -qx "vox grab" "$TEST_LOG"
  grep -q "^tmux load-buffer -w $HOME/grab.md$" "$TEST_LOG"
  grep -q "^tmux display-message copied the call so far · 3 words$" "$TEST_LOG"
}

@test "a window is passed through and named in the message" {
  stub_vox 0

  grab 5m

  [ "$status" -eq 0 ]
  grep -qx "vox grab 5m" "$TEST_LOG"
  grep -q "^tmux display-message copied the last 5m of the call · 3 words$" "$TEST_LOG"
}

@test "a failed grab shows vox's reason and copies nothing" {
  stub_vox 1 "vox: not recording — \`vox last\` is the newest transcript"

  grab

  [ "$status" -eq 0 ]
  ! grep -q "^tmux load-buffer" "$TEST_LOG"
  grep -q "^tmux display-message vox: not recording" "$TEST_LOG"
}

@test "a grab that recognised nothing is a failure, not an empty copy" {
  stub_vox 1 "vox: no speech recognised in the call so far — see /tmp/x/vox.log"

  grab

  [ "$status" -eq 0 ]
  ! grep -q "^tmux load-buffer" "$TEST_LOG"
  grep -q "^tmux display-message vox: no speech recognised" "$TEST_LOG"
}
