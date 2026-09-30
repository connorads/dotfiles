#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

HOOK="$ZSH_DIR/../../.hk-hooks/pre-commit"

setup() {
  setup_test_home

  write_stub hk <<'EOF'
#!/usr/bin/env bash
printf 'path args=%s\n' "$*" >>"$TEST_LOG"
EOF

  # A failing mise by default, so no test reaches the real one on PATH.
  write_stub mise <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
}

# A project's mise env can put its own hk first on PATH; the dotfiles pin
# (resolved from $HOME's mise config) must still win.
@test "pre-commit runs the hk mise resolves for HOME over the PATH hk" {
  mkdir -p "$BATS_TEST_TMPDIR/pinned"
  write_executable "$BATS_TEST_TMPDIR/pinned/hk" <<'EOF'
#!/usr/bin/env bash
printf 'pinned args=%s\n' "$*" >>"$TEST_LOG"
EOF
  write_stub mise <<EOF
#!/usr/bin/env bash
printf 'mise %s\n' "\$*" >>"\$TEST_LOG"
printf '%s\n' "$BATS_TEST_TMPDIR/pinned/hk"
EOF
  run sh "$HOOK"

  [ "$status" -eq 0 ]
  grep -Fxq "mise -C $HOME which hk" "$TEST_LOG"
  grep -Fxq "pinned args=run pre-commit -q" "$TEST_LOG"
  run ! grep -q '^path ' "$TEST_LOG"
}

@test "pre-commit falls back to the PATH hk when mise cannot resolve one" {
  run sh "$HOOK"

  [ "$status" -eq 0 ]
  grep -Fxq "path args=run pre-commit -q" "$TEST_LOG"
}

@test "HK=0 skips the hook without running hk" {
  HK=0 run sh "$HOOK"

  [ "$status" -eq 0 ]
  [ ! -s "$TEST_LOG" ]
}
