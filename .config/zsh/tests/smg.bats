#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

SMG="$FUNCTIONS_DIR/git/smg"

setup() {
  setup_test_home

  write_stub smerge <<'EOF'
#!/bin/sh
echo "smerge $*" >>"$TEST_LOG"
EOF
  write_stub dotfiles <<'EOF'
#!/bin/sh
echo "dotfiles $*" >>"$TEST_LOG"
EOF
}

@test "opens the enclosing repo's top level from a subdirectory" {
  git init --quiet "$HOME/proj"
  mkdir -p "$HOME/proj/src"
  cd "$HOME/proj/src"

  run_zsh_function "$SMG"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "smerge $(cd "$HOME/proj" && pwd -P)" ]
}

@test "outside any repo, refreshes dotfiles stat data then opens the dotfiles git dir" {
  mkdir -p "$HOME/scratch"
  cd "$HOME/scratch"

  run_zsh_function "$SMG"

  [ "$status" -eq 0 ]
  [ "$(sed -n 1p "$TEST_LOG")" = "dotfiles status --short .codex/config.toml .claude/settings.json .pi/agent/settings.json" ]
  [ "$(sed -n 2p "$TEST_LOG")" = "smerge $HOME/git/dotfiles" ]
}
