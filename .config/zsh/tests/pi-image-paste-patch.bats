#!/usr/bin/env bats

# Consumer of the shared engine at functions/patch/_needle-patch-lib; a staged
# engine runs it (bats-tests.sh maps a staged script to every suite that names
# it).
#
# Fixture-based: it builds a mise-shaped install dir with a generated bundle
# chunk defining the clipboard reader, so it needs no real pi install.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

PI_PATCH="$FUNCTIONS_DIR/pi/pi-image-paste-patch"
MARKER_REL=".cache/pi-image-paste-fileurl-patch.stale"
LAYOUT_MARKER_REL=".cache/pi-image-paste-patch.stale"

NEEDLE='let bytes=await getNativeClipboard()?.getImage();'
PATCHED='let bytes=(await getNativeClipboard()?.getImage());if(!bytes?.length&&process.platform==="darwin")'

# Write a bundle chunk defining the reader around whichever body is passed,
# plus an unrelated sibling chunk the resolver must skip.
write_chunk() {
  local chunks
  chunks="$(dirname "$CLIPBOARD")"
  mkdir -p "$chunks"
  printf 'function other(){return 1}\n' >"$chunks/chunk-OTHER.js"
  printf 'async function readClipboardImageViaNativeClipboard(){%s if(bytes!==void 0)return null}\n' "$1" >"$CLIPBOARD"
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

  mkdir -p "$pkgdir/dist/bundle/chunks" "$root/bin"
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

  mkdir -p "$pkgdir/dist/bundle/chunks" "$root/bin"
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

  mkdir -p "$pkgdir/dist/bundle/chunks" "$root/node_modules/.bin"
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
  CLIPBOARD="$pkgdir/dist/bundle/chunks/chunk-ABC123.js"
  write_chunk "$NEEDLE"
}

@test "--reapply patches the reader and clears the stale marker" {
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$CLIPBOARD"
  ! grep -qF "$NEEDLE" "$CLIPBOARD"
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--check reports unpatched, then patched" {
  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" == unpatched:* ]]

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"
  [ "$status" -eq 0 ]

  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" == patched:* ]]
}

@test "--restore puts the reader back and --reapply re-applies it" {
  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"
  [ "$status" -eq 0 ]

  run_zsh_function "$PI_PATCH" --restore "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$NEEDLE" "$CLIPBOARD"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$CLIPBOARD"
}

@test "a renamed needle marks and exits 0 under --reapply" {
  write_chunk 'let bytes=await getNativeClipboard()?.RENAMED();'

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  grep -qF "needle: $NEEDLE" "$HOME/$MARKER_REL"
}

@test "a missing reader chunk fails loudly outside --reapply and marks inside it" {
  rm -f "$CLIPBOARD"

  run_zsh_function "$PI_PATCH" --check "$INSTALL_DIR"

  [ "$status" -eq 1 ]
  [[ "$output" == *"found 0"* ]]

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ -f "$HOME/$LAYOUT_MARKER_REL" ]
}

@test "two chunks defining the reader refuse to patch either" {
  cp "$CLIPBOARD" "$(dirname "$CLIPBOARD")/chunk-DUP.js"

  run_zsh_function "$PI_PATCH" --reapply "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  grep -qF 'found 2' "$HOME/$LAYOUT_MARKER_REL"
  grep -qF "$NEEDLE" "$CLIPBOARD"
}

# ---- install layouts -------------------------------------------------------

@test "patches a layout C install, which has no bin dir at all" {
  # The regression this exists for: mise v2026.7.12 embedded aube as a library
  # and dropped <install>/bin, so resolving via bin/pi found nothing and every
  # pi update since would have shipped an unpatched Ctrl+V image paste.
  local root="$HOME/pi-c" pkgdir
  pkgdir=$(make_layout_c "$root")
  CLIPBOARD="$pkgdir/dist/bundle/chunks/chunk-ABC123.js"
  write_chunk "$NEEDLE"
  [ ! -d "$root/bin" ]

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$CLIPBOARD"
  [ ! -f "$HOME/$LAYOUT_MARKER_REL" ]
}

@test "patches a layout B install" {
  local root="$HOME/pi-b" pkgdir
  pkgdir=$(make_layout_b "$root")
  CLIPBOARD="$pkgdir/dist/bundle/chunks/chunk-ABC123.js"
  write_chunk "$NEEDLE"

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  grep -qF "$PATCHED" "$CLIPBOARD"
}

@test "an unresolvable package dir marks and exits 0 under --reapply" {
  # A layout mise has not shipped yet. --reapply must never block an update,
  # and the marker must say the package dir failed, not that a needle is gone.
  local root="$HOME/pi-unknown"
  mkdir -p "$root/some/future/shape"

  run_zsh_function "$PI_PATCH" --reapply "$root"

  [ "$status" -eq 0 ]
  [ -f "$HOME/$LAYOUT_MARKER_REL" ]
  grep -qF 'reason: could not resolve the pi package dir' \
    "$HOME/$LAYOUT_MARKER_REL"

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
  grep -qF "$PATCHED" "$CLIPBOARD"
}
