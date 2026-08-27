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

PI_PKG='@earendil-works/pi-coding-agent'

# The generated manifest mise writes beside an install; mise-npm-where reads
# its single dependencies key for the package name.
write_generated_manifest() {
  mkdir -p "$(dirname "$1")"
  cat >"$1" <<EOF
{
  "name": "mise-npm-install",
  "private": true,
  "dependencies": {
    "$PI_PKG": "1.0.0"
  }
}
EOF
}

# Layout A: aube driven as an external CLI. bin/pi is a symlink into a hashed
# global-aube dir, with a 64-hex sibling symlink pointing at the same hash dir.
# This is what 156 installs still look like.
make_layout_a() {
  local root=$1
  local hash=1bc6-1a02e683708
  local hex=c9fdf1237697ab36897fd1bede7bb4b9f52b436ff0615eb7667507413466c7b5
  local pkgdir="$root/global-aube/$hash/node_modules/$PI_PKG"

  mkdir -p "$pkgdir/dist/utils" "$root/bin"
  printf '{"name":"%s","version":"1.0.0"}\n' "$PI_PKG" >"$pkgdir/package.json"
  printf '#!/usr/bin/env node\n' >"$pkgdir/dist/cli.js"
  chmod +x "$pkgdir/dist/cli.js"
  ln -s "$pkgdir/dist/cli.js" "$root/bin/pi"
  ln -s "$root/global-aube/$hash" "$root/global-aube/$hex"
  write_generated_manifest "$root/global-aube/$hash/package.json"
  printf '%s\n' "$pkgdir"
}

# Layout B: the bun era - top-level node_modules plus a real bin/ dir.
make_layout_b() {
  local root=$1
  local pkgdir="$root/node_modules/$PI_PKG"

  mkdir -p "$pkgdir/dist/utils" "$root/bin"
  printf '{"name":"%s","version":"1.0.0"}\n' "$PI_PKG" >"$pkgdir/package.json"
  printf '#!/bin/sh\nexit 0\n' >"$root/bin/pi"
  chmod +x "$root/bin/pi"
  write_generated_manifest "$root/package.json"
  printf '%s\n' "$pkgdir"
}

# Layout C: aube embedded as a library - no bin/ at all. This is the layout the
# patch silently stopped resolving, and the regression this suite now covers.
make_layout_c() {
  local root=$1
  local pkgdir="$root/node_modules/$PI_PKG"

  mkdir -p "$pkgdir/dist/utils" "$root/node_modules/.bin"
  printf '{"name":"%s","version":"1.0.0"}\n' "$PI_PKG" >"$pkgdir/package.json"
  printf '#!/usr/bin/env node\n' >"$pkgdir/dist/cli.js"
  chmod +x "$pkgdir/dist/cli.js"
  ln -s "$pkgdir/dist/cli.js" "$root/node_modules/.bin/pi"
  write_generated_manifest "$root/package.json"
  printf '%s\n' "$pkgdir"
}

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"
  ln -s "$FUNCTIONS_DIR/mise" "$HOME/.config/zsh/functions/mise"

  INSTALL_DIR="$HOME/pi-install"
  local pkgdir
  pkgdir=$(make_layout_a "$INSTALL_DIR")
  CLIPBOARD="$pkgdir/dist/utils/clipboard-image.js"
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

# ---- install layouts -------------------------------------------------------

@test "patches a layout C install, which has no bin dir at all" {
  # The regression this exists for: mise v2026.7.12 embedded aube as a library
  # and dropped <install>/bin, so resolving via bin/pi found nothing and every
  # pi update since would have shipped an unpatched Ctrl+V image paste.
  local root="$HOME/pi-c" pkgdir
  pkgdir=$(make_layout_c "$root")
  CLIPBOARD="$pkgdir/dist/utils/clipboard-image.js"
  write_clipboard "$HASIMAGE_NEEDLE" "$GETIMAGE_NEEDLE"
  [ ! -d "$root/bin" ]

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
  [ ! -f "$HOME/.cache/pi-image-paste-patch.stale" ]
}

@test "patches a layout B install" {
  local root="$HOME/pi-b" pkgdir
  pkgdir=$(make_layout_b "$root")
  CLIPBOARD="$pkgdir/dist/utils/clipboard-image.js"
  write_clipboard "$HASIMAGE_NEEDLE" "$GETIMAGE_NEEDLE"

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
}

@test "an unresolvable package dir marks and exits 0 under --reapply" {
  # A layout mise has not shipped yet. --reapply must never block an update,
  # and the marker must say the package dir failed, not that a needle is gone.
  local root="$HOME/pi-unknown"
  mkdir -p "$root/some/future/shape"

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  [ -f "$HOME/.cache/pi-image-paste-patch.stale" ]
  grep -qF 'reason: could not resolve the pi package dir' \
    "$HOME/.cache/pi-image-paste-patch.stale"

  run_zsh_function "$PI_PATCH" --check "$root"

  [ "$status" -eq 1 ]
  [[ "$output" == *"could not resolve the pi package dir"* ]]
}

@test "with no install dir argument it asks mise where" {
  write_stub mise <<EOF
#!/usr/bin/env bash
[ "\$1" = "where" ] || exit 1
printf '%s\n' "$INSTALL_DIR"
EOF

  run_zsh_function "$PI_PATCH" --reapply

  [ "$status" -eq 0 ]
  grep -qF "$HASIMAGE_PATCHED" "$CLIPBOARD"
  grep -qF "$GETIMAGE_PATCHED" "$CLIPBOARD"
}
