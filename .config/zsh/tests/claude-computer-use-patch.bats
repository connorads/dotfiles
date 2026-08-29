#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

# Consumer of the shared engine at functions/patch/_needle-patch-lib: this suite
# is part of that engine's contract, so a staged engine runs it (bats-tests.sh
# maps a staged script to every suite that names it).
CU_PATCH="$FUNCTIONS_DIR/claude/claude-computer-use-patch"
MARKER_REL=".cache/claude-computer-use-patch.stale"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"
  NEEDLE='{enabled:!1,pixelValidation:'
  PATCHED='{enabled:!0,pixelValidation:'
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

# The 2.1.251 break: upstream inserted keys into the object's tail. A needle that
# pinned the whole literal missed it and computer-use silently reverted. Keys may
# be added there again, so the anchor must survive it.
@test "--reapply patches a config object carrying extra tail keys" {
  local reshaped='{enabled:!1,pixelValidation:!1,clipboardPasteMultiline:!0,mouseAnimation:!0,hideBeforeAction:!0,autoTargetDisplay:!0,clipboardGuard:!0,maskFailClosed:!0,adaptiveResolution:!1,coordinateMode:"pixels"}'
  printf 'prefix %s suffix' "$reshaped" >"$HOME/claude"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  grep -qF "$PATCHED" "$HOME/claude"
  # the inserted tail keys are untouched, so only the flag moved
  grep -qF 'maskFailClosed:!0,adaptiveResolution:!1,coordinateMode:"pixels"}' "$HOME/claude"
  ! grep -qF "$NEEDLE" "$HOME/claude"
}

# The short anchor's counterpart: it can over-match where the old whole-object
# needle could not, so a second site must refuse rather than patch both.
@test "a second config site is ambiguous: refused, marked, target untouched" {
  printf 'prefix %s middle %s suffix' "$NEEDLE" "$NEEDLE" >"$HOME/claude"
  cp "$HOME/claude" "$HOME/claude.expected"

  run_zsh_function "$CU_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE AMBIGUOUS"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  cmp -s "$HOME/claude" "$HOME/claude.expected"

  run_zsh_function "$CU_PATCH" --check "$HOME/claude"

  [ "$status" -eq 1 ]
  [[ "$output" == *"ambiguous:"* ]]
}
