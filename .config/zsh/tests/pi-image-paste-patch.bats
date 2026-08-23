#!/usr/bin/env bats

# Consumer of the shared engine at functions/patch/_needle-patch-lib, and the
# only one that sources it twice per run - once per sub-patch, from the same
# `_run_needle_patch` frame. So this suite is where a config var leaking from
# the first source into the second shows up, and a staged engine runs it
# (bats-tests.sh maps a staged script to every suite that names it).
#
# Fixture-based: it builds a mise-shaped install dir with a generated
# clipboard-image.js, so it needs no real pi install.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

PI_PATCH="$FUNCTIONS_DIR/pi/pi-image-paste-patch"
HASIMAGE_MARKER_REL=".cache/pi-image-paste-hasimage-patch.stale"
GETIMAGE_MARKER_REL=".cache/pi-image-paste-getimage-patch.stale"

HASIMAGE_NEEDLE='if (!clipboard || !clipboard.hasImage()) {'
HASIMAGE_PATCHED='if (!clipboard) {'
GETIMAGE_NEEDLE='const imageData = await clipboard.getImageBinary();'
GETIMAGE_PATCHED='const imageData = await Promise.resolve().then(() => clipboard.getImageBinary()).catch(() => null);'

# Write a clipboard-image.js carrying whichever lines are passed, wrapped in
# enough surrounding text that a needle is never the whole file.
write_clipboard() {
  local line
  {
    printf 'export async function readClipboardImageViaNativeClipboard() {\n'
    for line in "$@"; do
      printf '  %s\n' "$line"
    done
    printf '  return null;\n}\n'
  } >"$CLIPBOARD"
}

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"

  INSTALL_DIR="$HOME/pi-install"
  CLIPBOARD="$INSTALL_DIR/dist/utils/clipboard-image.js"
  mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/dist/utils"
  printf '#!/bin/sh\nexit 0\n' >"$INSTALL_DIR/bin/pi"
  chmod +x "$INSTALL_DIR/bin/pi"
  write_clipboard "$HASIMAGE_NEEDLE" "$GETIMAGE_NEEDLE"
}

@test "--reapply applies both sub-patches and clears both stale markers" {
  : >"$HOME/$HASIMAGE_MARKER_REL"
  : >"$HOME/$GETIMAGE_MARKER_REL"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
  ! grep -qF "$HASIMAGE_NEEDLE" "$CLIPBOARD"
  ! grep -qF "$GETIMAGE_NEEDLE" "$CLIPBOARD"
  [ ! -f "$HOME/$HASIMAGE_MARKER_REL" ]
  [ ! -f "$HOME/$GETIMAGE_MARKER_REL" ]
}

@test "--check reports both sub-patches unpatched, then patched" {
  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c '^unpatched:')" -eq 2 ]

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"
  [ "$status" -eq 0 ]

  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c '^patched:')" -eq 2 ]
}

@test "--restore puts both sub-patches back and --reapply re-applies them" {
  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"
  [ "$status" -eq 0 ]

  run_zsh_function "$PI_PATCH" --restore "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_NEEDLE" "$CLIPBOARD"
  grep -qF "$GETIMAGE_NEEDLE" "$CLIPBOARD"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
}

@test "the first sub-patch's missing needle does not leak into the second" {
  # Only the getImageBinary line survives, so sub-patch one must warn and mark
  # while sub-patch two still patches and clears its own marker.
  write_clipboard 'if (!clipboard || clipboard.RENAMED()) {' "$GETIMAGE_NEEDLE"
  : >"$HOME/$GETIMAGE_MARKER_REL"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$HOME/$HASIMAGE_MARKER_REL" ]
  grep -qF 'pi-image-paste-hasimage-patch' "$HOME/$HASIMAGE_MARKER_REL"
  grep -qF "needle: $HASIMAGE_NEEDLE" "$HOME/$HASIMAGE_MARKER_REL"
  [ ! -f "$HOME/$GETIMAGE_MARKER_REL" ]
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
}

@test "the second sub-patch's missing needle does not mark the first" {
  write_clipboard "$HASIMAGE_NEEDLE" 'const imageData = await clipboard.RENAMED();'
  : >"$HOME/$HASIMAGE_MARKER_REL"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$HOME/$GETIMAGE_MARKER_REL" ]
  grep -qF "needle: $GETIMAGE_NEEDLE" "$HOME/$GETIMAGE_MARKER_REL"
  [ ! -f "$HOME/$HASIMAGE_MARKER_REL" ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
}

@test "a missing target file fails loudly outside --reapply and marks inside it" {
  rm -f "$CLIPBOARD"

  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 1 ]
  [[ "$output" == *"missing target file"* ]]

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.cache/pi-image-paste-patch.stale" ]
}
