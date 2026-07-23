#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

source "$BATS_TEST_DIRNAME/test_helper.bash"

setup() {
  setup_test_home
}

# Minimal wt-status stub: wtui pipes its output through awk into fzf, which is
# itself stubbed, so the content is irrelevant — only that the command exists.
stub_wt_status() {
  write_stub wt-status <<'EOF'
#!/usr/bin/env bash
:
EOF
}

run_wtui() {
  local runner="$BATS_TEST_TMPDIR/run-wtui.zsh"
  cat >"$runner" <<EOF
fpath=('$FUNCTIONS_DIR/git' \$fpath)
autoload -Uz wtui
wtui
EOF
  run bash -lc "export HOME='$HOME' PATH='$PATH' TEST_LOG='$TEST_LOG'; zsh --no-rcs -i '$runner' </dev/null"
}

@test "wtui alt-r removes every selected clean worktree" {
  local p1="$HOME/.trees/repo/a" p2="$HOME/.trees/repo/b"
  mkdir -p "$p1" "$p2"

  stub_wt_status
  write_stub fzf <<EOF
#!/usr/bin/env bash
cat >/dev/null
printf 'alt-r\n%s\ta\tclean\t- none\t\t+0/-0\t\n%s\tb\tclean\t- none\t\t+0/-0\t\n' '$p1' '$p2'
EOF
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >> "$TEST_LOG"
EOF

  run_wtui

  [ "$status" -eq 0 ]
  grep -q -- "wt-remove $p1" "$TEST_LOG"
  grep -q -- "wt-remove $p2" "$TEST_LOG"
}

@test "wtui alt-R delegates to wt-clean --all" {
  local p1="$HOME/.trees/repo/a"
  mkdir -p "$p1"

  stub_wt_status
  write_stub fzf <<EOF
#!/usr/bin/env bash
cat >/dev/null
printf 'alt-R\n%s\ta\tclean\t#42 MERGED\treap\t+0/-0\t\n' '$p1'
EOF
  write_stub wt-clean <<'EOF'
#!/usr/bin/env bash
printf 'wt-clean %s\n' "$*" >> "$TEST_LOG"
EOF
  write_stub wt-remove <<'EOF'
#!/usr/bin/env bash
printf 'wt-remove %s\n' "$*" >> "$TEST_LOG"
EOF

  run_wtui

  [ "$status" -eq 0 ]
  grep -q -- "wt-clean --all" "$TEST_LOG"
  ! grep -q "wt-remove" "$TEST_LOG"
}
