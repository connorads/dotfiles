#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

write_patch_wrapper() {
  local path="$BATS_TEST_TMPDIR/needle-wrapper"
  local lib_path="$FUNCTIONS_DIR/patch/_needle-patch-lib"

  cat >"$path" <<EOF
#!/usr/bin/env zsh
# needle-wrapper: test wrapper for _needle-patch-lib
# usage: needle-wrapper [--check|--restore|--all|--reapply] [target...]
emulate -L zsh
setopt no_unset pipe_fail

local wrapper="\${\${(%):-%x}:A}"
local patch_name=test-needle-patch
local patch_label='test replacement'
local needle=BEFORE
local replace=AFTER
local marker="\$HOME/.cache/test-needle-patch.stale"
local missing_body='The test patch needle was not found.'
local missing_banner='test replacement will revert'

if [[ \${NEEDLE_PATCH_DEFINE_RESOLVER:-0} == 1 ]]; then
  needle_patch_resolve_targets() {
    [[ -n \${NEEDLE_PATCH_RESOLVER_FIRST:-} ]] && print -r -- "\$NEEDLE_PATCH_RESOLVER_FIRST"
    if [[ "\$1" == 1 ]]; then
      [[ -n \${NEEDLE_PATCH_RESOLVER_SECOND:-} ]] && print -r -- "\$NEEDLE_PATCH_RESOLVER_SECOND"
      [[ -n \${NEEDLE_PATCH_RESOLVER_DUPLICATE:-} ]] && print -r -- "\$NEEDLE_PATCH_RESOLVER_DUPLICATE"
    fi
  }
fi

source "$lib_path" "\$@"
EOF
  chmod +x "$path"
  printf '%s\n' "$path"
}

write_broken_patch_wrapper() {
  local path="$BATS_TEST_TMPDIR/broken-needle-wrapper"
  local lib_path="$FUNCTIONS_DIR/patch/_needle-patch-lib"

  cat >"$path" <<EOF
#!/usr/bin/env zsh
emulate -L zsh
setopt no_unset pipe_fail

local wrapper="\${\${(%):-%x}:A}"
local patch_name=test-needle-patch
local patch_label='test replacement'
local needle=BEFORE
local replace=AFTER
# marker, missing_body, and missing_banner intentionally omitted.

source "$lib_path" "\$@"
EOF
  chmod +x "$path"
  printf '%s\n' "$path"
}

realpath_of() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache"
  WRAPPER="$(write_patch_wrapper)"
}

@test "--check reports patched, unpatched, no-pattern, and mixed targets" {
  local unpatched="$HOME/unpatched.bundle"
  local patched="$HOME/patched.bundle"
  local no_pattern="$HOME/no-pattern.bundle"
  local mixed="$HOME/mixed.bundle"
  printf 'prefix BEFORE suffix' >"$unpatched"
  printf 'prefix AFTER suffix' >"$patched"
  printf 'prefix unchanged suffix' >"$no_pattern"
  printf 'prefix BEFORE and AFTER suffix' >"$mixed"

  local unpatched_real patched_real no_pattern_real mixed_real
  unpatched_real="$(realpath_of "$unpatched")"
  patched_real="$(realpath_of "$patched")"
  no_pattern_real="$(realpath_of "$no_pattern")"
  mixed_real="$(realpath_of "$mixed")"

  run_zsh_function "$WRAPPER" --check "$unpatched" "$patched" "$no_pattern" "$mixed"

  [ "$status" -eq 1 ]
  [[ "$output" == *"unpatched:  $unpatched_real (1 occurrence(s))"* ]]
  [[ "$output" == *"patched:    $patched_real"* ]]
  [[ "$output" == *"no-pattern: $no_pattern_real (different version?)"* ]]
  [[ "$output" == *"mixed:      $mixed_real (before=1 after=1)"* ]]
}

@test "patch mode replaces all occurrences and keeps the original backup" {
  local target="$HOME/app.bundle"
  printf 'BEFORE middle BEFORE' >"$target"

  local target_real
  target_real="$(realpath_of "$target")"

  run_zsh_function "$WRAPPER" "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:    $target_real (2 occurrence(s); backup at $target_real.unpatched)"* ]]
  grep -qF 'AFTER middle AFTER' "$target"
  grep -qF 'BEFORE middle BEFORE' "$target.unpatched"
}

@test "restore copies the backup back over the patched target" {
  local target="$HOME/app.bundle"
  printf 'BEFORE' >"$target"
  run_zsh_function "$WRAPPER" "$target"
  [ "$status" -eq 0 ]

  local target_real
  target_real="$(realpath_of "$target")"

  run_zsh_function "$WRAPPER" --restore "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"restored:   $target_real (from $target_real.unpatched)"* ]]
  grep -qF 'BEFORE' "$target"
}

@test "restore without a backup fails loudly" {
  local target="$HOME/app.bundle"
  printf 'AFTER' >"$target"

  local target_real
  target_real="$(realpath_of "$target")"

  run_zsh_function "$WRAPPER" --restore "$target"

  [ "$status" -eq 1 ]
  [[ "$output" == *"no backup at $target_real.unpatched: $target_real"* ]]
}

@test "missing target returns failure and skips the path" {
  local target="$HOME/missing.bundle"

  run_zsh_function "$WRAPPER" "$target"

  [ "$status" -eq 1 ]
  [[ "$output" == *"skip (missing): $target"* ]]
}

@test "explicit targets or a resolver are required" {
  run_zsh_function "$WRAPPER"

  [ "$status" -eq 1 ]
  [[ "$output" == *"_needle-patch-lib: no targets supplied and no needle_patch_resolve_targets function defined"* ]]
}

@test "missing required wrapper settings fail before touching targets" {
  local broken_wrapper
  local target="$HOME/app.bundle"
  broken_wrapper="$(write_broken_patch_wrapper)"
  printf 'BEFORE' >"$target"

  run_zsh_function "$broken_wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"_needle-patch-lib: missing required setting: marker"* ]]
  grep -qF 'BEFORE' "$target"
}

@test "--reapply writes a stale marker and exits zero when the needle is gone" {
  local target="$HOME/app.bundle"
  local marker="$HOME/.cache/test-needle-patch.stale"
  printf 'prefix RENAMED suffix' >"$target"

  local target_real
  target_real="$(realpath_of "$target")"

  run_zsh_function "$WRAPPER" --reapply "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$marker" ]
  grep -qF 'test-needle-patch could not reapply the test replacement patch.' "$marker"
  grep -qF "target: $target_real" "$marker"
  grep -qF 'needle: BEFORE' "$marker"
}

@test "resolver honours --all and dedupes symlinked targets" {
  local first="$HOME/first.bundle"
  local first_link="$HOME/first-link.bundle"
  local second="$HOME/second.bundle"
  printf 'BEFORE' >"$first"
  printf 'BEFORE' >"$second"
  ln -s "$first" "$first_link"
  export NEEDLE_PATCH_DEFINE_RESOLVER=1
  export NEEDLE_PATCH_RESOLVER_FIRST="$first_link"
  export NEEDLE_PATCH_RESOLVER_SECOND="$second"
  export NEEDLE_PATCH_RESOLVER_DUPLICATE="$first"

  run_zsh_function "$WRAPPER" --all

  [ "$status" -eq 0 ]
  grep -qF 'AFTER' "$first"
  grep -qF 'AFTER' "$second"
  [ "$(printf '%s\n' "$output" | grep -c '^patched:')" -eq 2 ]
}
