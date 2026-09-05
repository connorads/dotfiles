#!/usr/bin/env bats

setup() {
  export TEST_HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$TEST_HOME/.config/opencode" "$BATS_TEST_TMPDIR/bin"
  cp "$HOME/.config/zsh/functions/agents/oc2" "$BATS_TEST_TMPDIR/oc2"
  cp "$HOME/.config/zsh/functions/agents/oc2y" "$BATS_TEST_TMPDIR/oc2y"
  cat >"$BATS_TEST_TMPDIR/bin/opencode2" <<'EOF'
#!/bin/sh
printf 'db=%s\nconfig=%s\nargs=%s\n' "$OPENCODE_DB" "$OPENCODE_CONFIG" "$*"
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/opencode2"
  export HOME="$TEST_HOME"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

@test "oc2 isolates database and adds standalone" {
  run zsh "$BATS_TEST_TMPDIR/oc2" run hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"db=opencode2.db"* ]]
  [[ "$output" == *"opencode2.json"* ]]
  [[ "$output" == *"args=run --standalone hello"* ]]
}

@test "oc2y selects broad-allow config without auto" {
  run zsh "$BATS_TEST_TMPDIR/oc2y" run hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"opencode2-yolo.json"* ]]
  [[ "$output" != *"--auto"* ]]
}

@test "safe launchers reject server modes" {
  run zsh "$BATS_TEST_TMPDIR/oc2" serve
  [ "$status" -eq 2 ]
  [[ "$output" == *"use opencode2 directly"* ]]
}
