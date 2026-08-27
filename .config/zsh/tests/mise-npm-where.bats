#!/usr/bin/env bats

# mise-npm-where resolves the installed package dir for an npm-backed mise tool
# across the three install layouts mise's npm backend has shipped. The fixtures
# reproduce the real symlink shapes rather than plain files, because the
# symlinks are what the probes traverse - a fixture built from regular files
# can pass while the resolver is wrong about the layout it claims to handle.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MNW="$FUNCTIONS_DIR/mise/mise-npm-where"

# The generated manifest mise writes next to an install; its single
# `dependencies` key is the resolver's primary source for the package name.
write_generated_manifest() {
  local path=$1 pkg=$2 version=$3
  mkdir -p "$(dirname "$path")"
  cat >"$path" <<EOF
{
  "name": "mise-npm-install",
  "private": true,
  "dependencies": {
    "$pkg": "$version"
  }
}
EOF
}

# Layout A: aube driven as an external CLI. The package lives in a hashed
# global-aube dir, the install's bin/ holds a symlink into it, and a 64-hex
# sibling symlink points at the same hash dir.
make_layout_a() {
  local root=$1 pkg=${2:-@earendil-works/pi-coding-agent} cmd=${3:-pi}
  local hash=1bc6-1a02e683708
  local hex=c9fdf1237697ab36897fd1bede7bb4b9f52b436ff0615eb7667507413466c7b5
  local pkgdir="$root/global-aube/$hash/node_modules/$pkg"

  mkdir -p "$pkgdir/dist" "$root/bin"
  printf '{"name":"%s","version":"1.0.0"}\n' "$pkg" >"$pkgdir/package.json"
  printf '#!/usr/bin/env node\n' >"$pkgdir/dist/cli.js"
  chmod +x "$pkgdir/dist/cli.js"
  ln -s "$pkgdir/dist/cli.js" "$root/bin/$cmd"
  ln -s "$root/global-aube/$hash" "$root/global-aube/$hex"
  write_generated_manifest "$root/global-aube/$hash/package.json" "$pkg" 1.0.0
  printf '%s\n' "$pkgdir"
}

# Layout B: the bun era - a top-level node_modules plus a real bin/ dir.
make_layout_b() {
  local root=$1 pkg=${2:-critique} cmd=${3:-critique}
  local pkgdir="$root/node_modules/$pkg"

  mkdir -p "$pkgdir/src" "$root/bin"
  printf '{"name":"%s","version":"1.0.0"}\n' "$pkg" >"$pkgdir/package.json"
  printf '#!/usr/bin/env node\n' >"$root/bin/$cmd"
  chmod +x "$root/bin/$cmd"
  write_generated_manifest "$root/package.json" "$pkg" 1.0.0
  printf '%s\n' "$pkgdir"
}

# Layout C: aube embedded as a library - no bin/ at all, bins under
# node_modules/.bin, and the virtual store branded node_modules/.mise.
make_layout_c() {
  local root=$1 pkg=${2:-@tobilu/qmd} cmd=${3:-qmd}
  local pkgdir="$root/node_modules/$pkg"

  mkdir -p "$pkgdir/dist" "$root/node_modules/.bin" "$root/node_modules/.mise"
  printf '{"name":"%s","version":"1.0.0"}\n' "$pkg" >"$pkgdir/package.json"
  printf '#!/usr/bin/env node\n' >"$pkgdir/dist/cli.js"
  chmod +x "$pkgdir/dist/cli.js"
  ln -s "$pkgdir/dist/cli.js" "$root/node_modules/.bin/$cmd"
  write_generated_manifest "$root/package.json" "$pkg" 1.0.0
  printf '%s\n' "$pkgdir"
}

setup() {
  setup_test_home
  INSTALL_DIR="$HOME/install"
  mkdir -p "$INSTALL_DIR"
}

@test "resolves the package dir under layout A (global-aube)" {
  local want
  want=$(make_layout_a "$INSTALL_DIR")

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}

@test "resolves the package dir under layout B (top-level node_modules + bin)" {
  local want
  want=$(make_layout_b "$INSTALL_DIR")

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}

@test "resolves the package dir under layout C (no bin dir)" {
  local want
  want=$(make_layout_c "$INSTALL_DIR")

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
  [ ! -d "$INSTALL_DIR/bin" ]
}

@test "a scoped package name is matched literally, not globbed" {
  local want
  want=$(make_layout_c "$INSTALL_DIR" "@scope/name" name)
  # A decoy that a naive @scope/* glob would reach first.
  mkdir -p "$INSTALL_DIR/node_modules/@scope/other"
  printf '{"name":"@scope/other"}\n' >"$INSTALL_DIR/node_modules/@scope/other/package.json"

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR" --package "@scope/name"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}

@test "the package name comes from the generated package.json when not given" {
  local want
  want=$(make_layout_c "$INSTALL_DIR" "@vendor/tool-with-a-mangled-name" tool)

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}

@test "TOOL alone consults mise where" {
  local want
  want=$(make_layout_c "$INSTALL_DIR")
  write_stub mise <<EOF
#!/usr/bin/env bash
[ "\$1" = "where" ] || exit 1
[ "\$2" = "npm:@tobilu/qmd" ] || exit 1
printf '%s\n' "$INSTALL_DIR"
EOF

  run_zsh_function "$MNW" npm:@tobilu/qmd

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}

@test "a failing mise where exits 1 with empty stdout" {
  # The qmd bug in miniature: a caller doing "$(mise-npm-where ...)/dist/x"
  # must get nothing to concatenate, never a half-built path.
  write_stub mise <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run --separate-stderr zsh --no-rcs "$MNW" npm:not-installed

  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"could not resolve an install dir"* ]]
}

@test "nothing found exits 1 naming every probed path" {
  write_generated_manifest "$INSTALL_DIR/package.json" "ghost" 1.0.0

  run --separate-stderr zsh --no-rcs "$MNW" --install-dir "$INSTALL_DIR"

  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$stderr" == *"$INSTALL_DIR/lib/node_modules/ghost/package.json"* ]]
  [[ "$stderr" == *"$INSTALL_DIR/node_modules/ghost/package.json"* ]]
  [[ "$stderr" == *"global-aube"* ]]
}

@test "no arguments is a usage error" {
  run_zsh_function "$MNW"

  [ "$status" -eq 2 ]
  [[ "$output" == *"usage: mise-npm-where"* ]]
}

@test "layout C wins when a stale layout A sits alongside it" {
  # A --force reinstall can leave both shapes in one dir; the top-level
  # node_modules is the live one.
  make_layout_a "$INSTALL_DIR" "@tobilu/qmd" qmd >/dev/null
  local want
  want=$(make_layout_c "$INSTALL_DIR")

  run_zsh_function "$MNW" --install-dir "$INSTALL_DIR" --package "@tobilu/qmd"

  [ "$status" -eq 0 ]
  [ "$output" = "$want" ]
}
