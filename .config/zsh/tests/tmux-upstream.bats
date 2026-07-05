#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

TMUX_UPSTREAM="$FUNCTIONS_DIR/tmux-upstream"

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/nix/modules"
  ln -s "$(command -v jq)" "$TEST_BIN/jq"
}

write_pins() {
  cat >"$HOME/.config/nix/modules/home-shared.nix" <<'EOF'
    pin_tmux_plugin "fresh-plugin" "upstream/fresh-plugin" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    pin_tmux_plugin "stale-plugin" "upstream/stale-plugin" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
EOF
}

# gh stub: repos/<repo> -> default branch, repos/<repo>/compare/... -> compare
# JSON; "stale" repos report 2 commits behind, everything else up to date.
write_gh_stub() {
  write_stub gh <<'EOF'
#!/usr/bin/env bash
case "$2" in
  repos/*/compare/*)
    case "$2" in
      *stale*) echo '{"behind":2,"commits":["fix: guard empty pane","feat: add colour option"]}' ;;
      *) echo '{"behind":0,"commits":[]}' ;;
    esac ;;
  repos/*)
    echo main ;;
esac
EOF
}

@test "reports up-to-date and behind pins with counts" {
  write_pins
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 0 ]
  [[ "$output" == *"fresh-plugin"*"✓ up to date"* ]]
  [[ "$output" == *"stale-plugin"*"⚠ 2 commits behind"* ]]
}

@test "behind pins print bump instructions pointing at home-shared.nix" {
  write_pins
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 0 ]
  [[ "$output" == *"bump the sha"* ]]
  [[ "$output" == *"home-shared.nix"* ]]
}

@test "verbose lists upstream commit subjects for behind pins" {
  write_pins
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM" -v

  [ "$status" -eq 0 ]
  [[ "$output" == *"· fix: guard empty pane"* ]]
  [[ "$output" == *"· feat: add colour option"* ]]
}

@test "all pins up to date prints no bump instructions" {
  cat >"$HOME/.config/nix/modules/home-shared.nix" <<'EOF'
    pin_tmux_plugin "fresh-plugin" "upstream/fresh-plugin" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
EOF
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 0 ]
  [[ "$output" == *"✓ up to date"* ]]
  [[ "$output" != *"bump the sha"* ]]
}

@test "fails when home-shared.nix is missing" {
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 1 ]
  [[ "$output" == *"home-shared.nix not found"* ]]
}

@test "fails when no pin_tmux_plugin entries exist" {
  : >"$HOME/.config/nix/modules/home-shared.nix"
  write_gh_stub

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 1 ]
  [[ "$output" == *"No pin_tmux_plugin entries"* ]]
}

@test "gh query failure reports plugin as unqueryable, keeps going" {
  write_pins
  write_stub gh <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run_zsh_function "$TMUX_UPSTREAM"

  [ "$status" -eq 0 ]
  [[ "$output" == *"? could not query upstream/fresh-plugin"* ]]
  [[ "$output" == *"? could not query upstream/stale-plugin"* ]]
}
