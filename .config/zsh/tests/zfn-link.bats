#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ZFN_LINK="$FUNCTIONS_DIR/shell/zfn-link"

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/zsh/functions/git" "$HOME/.local/bin"
}

@test "links only shebang-marked functions with relative symlinks" {
  cat > "$HOME/.config/zsh/functions/git/dual" <<'EOF'
#!/usr/bin/env zsh
echo dual
EOF
  cat > "$HOME/.config/zsh/functions/git/plain" <<'EOF'
# plain zsh helper
echo plain
EOF

  run_zsh_function "$ZFN_LINK"

  [ "$status" -eq 0 ]
  assert_symlink_target "$HOME/.local/bin/dual" "../../.config/zsh/functions/git/dual"
  [ ! -e "$HOME/.local/bin/plain" ]
}

@test "removes stale links whose targets are no longer expected" {
  cat > "$HOME/.config/zsh/functions/git/dual" <<'EOF'
#!/usr/bin/env zsh
echo dual
EOF
  ln -s "../../missing" "$HOME/.local/bin/stale"

  run_zsh_function "$ZFN_LINK"

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.local/bin/stale" ]
}

@test "dry-run does not create links" {
  cat > "$HOME/.config/zsh/functions/git/dual" <<'EOF'
#!/usr/bin/env zsh
echo dual
EOF

  run_zsh_function "$ZFN_LINK" --dry-run --verbose

  [ "$status" -eq 0 ]
  [[ "$output" == *"Creating: $HOME/.local/bin/dual -> ../../.config/zsh/functions/git/dual"* ]]
  [ ! -e "$HOME/.local/bin/dual" ]
}
