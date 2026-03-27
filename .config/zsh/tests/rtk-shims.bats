#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

RTK_SHIMS="$FUNCTIONS_DIR/agents/rtk-shims"

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/zsh/functions/agents"
  printf '#!/usr/bin/env zsh\n' > "$HOME/.config/zsh/functions/agents/.rtk-shim"
}

@test "sync creates shim directory, control symlink, and README" {
  run_zsh_function "$RTK_SHIMS" sync

  [ "$status" -eq 0 ]
  [[ "$output" == *"Created "* ]]
  assert_symlink_target "$HOME/.local/lib/rtk-shims/.rtk-shim" "$HOME/.config/zsh/functions/agents/.rtk-shim"
  assert_symlink_target "$HOME/.local/lib/rtk-shims/git" ".rtk-shim"
  [ -f "$HOME/.local/lib/rtk-shims/README.md" ]
}

@test "sync removes stale shims" {
  mkdir -p "$HOME/.local/lib/rtk-shims"
  ln -s .rtk-shim "$HOME/.local/lib/rtk-shims/not-a-real-command"

  run_zsh_function "$RTK_SHIMS" sync

  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.local/lib/rtk-shims/not-a-real-command" ]
}

@test "dry-run reports work without creating files" {
  run_zsh_function "$RTK_SHIMS" --dry-run --verbose sync

  [ "$status" -eq 0 ]
  [[ "$output" == *"Would create: $HOME/.local/lib/rtk-shims/.rtk-shim"* ]]
  [ ! -d "$HOME/.local/lib/rtk-shims" ]
}

@test "list reports missing shims" {
  mkdir -p "$HOME/.local/lib/rtk-shims"
  ln -s .rtk-shim "$HOME/.local/lib/rtk-shims/git"

  run_zsh_function "$RTK_SHIMS" list

  [ "$status" -eq 0 ]
  [[ "$output" == *"Present: 1 /"* ]]
  [[ "$output" == *"Missing:"* ]]
}

@test "clean removes the shim directory" {
  mkdir -p "$HOME/.local/lib/rtk-shims"

  run_zsh_function "$RTK_SHIMS" clean

  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.local/lib/rtk-shims" ]
}
