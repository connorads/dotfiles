#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

CU_PATCH="$FUNCTIONS_DIR/claude/claude-computer-use-patch"
MARKER_REL=".cache/claude-computer-use-patch.stale"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"
  NEEDLE='{enabled:!1,pixelValidation:!1,clipboardPasteMultiline:!0,mouseAnimation:!0,hideBeforeAction:!0,autoTargetDisplay:!0,clipboardGuard:!0,coordinateMode:"pixels"}'
  PATCHED='{enabled:!0,pixelValidation:!1,clipboardPasteMultiline:!0,mouseAnimation:!0,hideBeforeAction:!0,autoTargetDisplay:!0,clipboardGuard:!0,coordinateMode:"pixels"}'
}

@test "--reapply patches an unpatched bundle and clears the stale marker" {
  printf 'prefix %s suffix' "$NEEDLE" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  grep -qF "$PATCHED" "$HOME/claude"
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply on an already-patched bundle is a no-op and clears the marker" {
  printf 'prefix %s suffix' "$PATCHED" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"already patched"* ]]
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply re-patches after a --restore" {
  printf 'prefix %s suffix' "$NEEDLE" >"$HOME/claude"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$HOME/claude"

  run_zsh_function "$CU_PATCH" --restore "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$NEEDLE" "$HOME/claude"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$HOME/claude"
}

@test "--reapply warns and writes a marker when the needle is gone, exiting 0" {
  printf 'prefix {enabled:!1,RESHAPED} suffix' >"$HOME/claude"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  grep -qF "$HOME/claude" "$HOME/$MARKER_REL"
}
