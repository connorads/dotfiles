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
# AFTER is a byte shorter than BEFORE, so this wrapper opts out.
local same_length=0

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

# Same wrapper, but with needle/replace given as zsh literals (so a test can use
# bytes a shell argument cannot carry - newline, NUL) plus any extra settings
# lines the test wants, e.g. 'local needle_kind=slots'.
write_literal_patch_wrapper() {
  local needle_literal="$1"
  local replace_literal="$2"
  local extra="${3:-local same_length=0}"
  local path="$BATS_TEST_TMPDIR/literal-needle-wrapper"
  local lib_path="$FUNCTIONS_DIR/patch/_needle-patch-lib"

  cat >"$path" <<EOF
#!/usr/bin/env zsh
# literal-needle-wrapper: test wrapper with an arbitrary-byte needle
# usage: literal-needle-wrapper [--check|--restore|--all|--reapply] [target...]
emulate -L zsh
setopt no_unset pipe_fail

local wrapper="\${\${(%):-%x}:A}"
local patch_name=test-needle-patch
local patch_label='test replacement'
local needle=$needle_literal
local replace=$replace_literal
local marker="\$HOME/.cache/test-needle-patch.stale"
local missing_body='The test patch needle was not found.'
local missing_banner='test replacement will revert'
$extra

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

@test "a needle spanning a newline is found and replaced" {
  local wrapper target expected
  wrapper="$(write_literal_patch_wrapper "\$'ALPHA\\nBETA'" "\$'GAMMA\\nDELTA'")"
  target="$HOME/multiline.bundle"
  expected="$HOME/multiline.expected"
  printf 'head\nALPHA\nBETA\ntail\n' >"$target"
  printf 'head\nGAMMA\nDELTA\ntail\n' >"$expected"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"(1 occurrence(s);"* ]]
  cmp -s "$target" "$expected"
}

@test "NUL and newline bytes around the needle survive a patch" {
  local target="$HOME/binary.bundle"
  local expected="$HOME/binary.expected"
  printf 'pre\000\nBEFORE\000\npost' >"$target"
  printf 'pre\000\nAFTER\000\npost' >"$expected"

  run_zsh_function "$WRAPPER" "$target"

  [ "$status" -eq 0 ]
  cmp -s "$target" "$expected"
}

@test "slot mode patches two different minified names in one run" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'if(!%s.dev){'" "'if(0&&%s.d){'" \
    $'local needle_kind=slots\nlocal same_length=1')"
  target="$HOME/renamed.bundle"
  printf 'aa if(!o.dev){ bb if(!i.dev){ cc' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"(2 occurrence(s);"* ]]
  grep -qF 'aa if(0&&o.d){ bb if(0&&i.d){ cc' "$target"
}

@test "slot mode holds same_length for an arbitrarily long identifier" {
  local wrapper target before_bytes after_bytes
  wrapper="$(write_literal_patch_wrapper "'if(!%s.dev){'" "'if(0&&%s.d){'" \
    $'local needle_kind=slots\nlocal same_length=1')"
  target="$HOME/longname.bundle"
  printf 'aa if(!$aVeryLongMinifiedName_42.dev){ bb' >"$target"
  before_bytes=$(wc -c <"$target")

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 0 ]
  grep -qF 'if(0&&$aVeryLongMinifiedName_42.d){' "$target"
  after_bytes=$(wc -c <"$target")
  [ "$before_bytes" -eq "$after_bytes" ]
}

@test "slot mode does not match a non-identifier or an empty slot" {
  local wrapper empty_slot digit_lead
  wrapper="$(write_literal_patch_wrapper "'BEFORE(%s)!'" "'AFTER(%s)!'" \
    $'local needle_kind=slots\nlocal same_length=0')"
  empty_slot="$HOME/empty-slot.bundle"
  digit_lead="$HOME/digit-lead.bundle"
  printf 'x BEFORE()! y' >"$empty_slot"
  printf 'x BEFORE(9x)! y' >"$digit_lead"

  run_zsh_function "$wrapper" --check "$empty_slot" "$digit_lead"

  [ "$status" -eq 1 ]
  [ "$(printf '%s\n' "$output" | grep -c '^no-pattern:')" -eq 2 ]
}

@test "slot mode reads %% as a literal percent, not a slot" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'%%d(%s)'" "'%%x(%s)'" \
    $'local needle_kind=slots\nlocal same_length=1')"
  target="$HOME/percent.bundle"
  printf 'aa %%d(fmt) bb' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 0 ]
  grep -qF 'aa %x(fmt) bb' "$target"
}

@test "a malformed slot spec exits 2 and leaves the target untouched" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'BEFORE(%d)'" "'AFTER(%d)'" \
    $'local needle_kind=slots\nlocal same_length=0')"
  target="$HOME/app.bundle"
  printf 'BEFORE(x)' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"'%' must be followed by 's' or '%'"* ]]
  grep -qF 'BEFORE(x)' "$target"
  [ ! -f "$target.unpatched" ]
}

@test "a slot count mismatch exits 2 and leaves the target untouched" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'BEFORE(%s)'" "'AFTER(%s,%s)'" \
    $'local needle_kind=slots\nlocal same_length=0')"
  target="$HOME/app.bundle"
  printf 'BEFORE(x)' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"slot count mismatch"* ]]
  grep -qF 'BEFORE(x)' "$target"
}

@test "a same_length violation exits 2 before opening the target" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'BEFORE'" "'AFTER'" 'local same_length=1')"
  target="$HOME/app.bundle"
  printf 'BEFORE' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"replacement changes length by -1 bytes"* ]]
  grep -qF 'BEFORE' "$target"
  [ ! -f "$target.unpatched" ]
}

@test "an unknown needle_kind exits 2" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'BEFORE'" "'AFTER'" \
    $'local needle_kind=regex\nlocal same_length=0')"
  target="$HOME/app.bundle"
  printf 'BEFORE' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"needle_kind: expected 'literal' or 'slots'"* ]]
  grep -qF 'BEFORE' "$target"
}

@test "expect_matches=1 patches a single site and reports a second as ambiguous" {
  local wrapper single double
  wrapper="$(write_literal_patch_wrapper "'if(!%s.dev){'" "'if(0&&%s.d){'" \
    $'local needle_kind=slots\nlocal same_length=1\nlocal expect_matches=1')"
  single="$HOME/single.bundle"
  double="$HOME/double.bundle"
  printf 'aa if(!i.dev){ bb' >"$single"
  printf 'aa if(!o.dev){ bb if(!i.dev){ cc' >"$double"

  run_zsh_function "$wrapper" --check "$single" "$double"

  [ "$status" -eq 1 ]
  [[ "$output" == *"unpatched:  $(realpath_of "$single") (1 occurrence(s))"* ]]
  [[ "$output" == *"ambiguous:  $(realpath_of "$double") (before=2 expected=1)"* ]]
}

@test "an ambiguous target is left byte-identical and unbacked-up" {
  local wrapper target expected
  wrapper="$(write_literal_patch_wrapper "'if(!%s.dev){'" "'if(0&&%s.d){'" \
    $'local needle_kind=slots\nlocal same_length=1\nlocal expect_matches=1')"
  target="$HOME/double.bundle"
  expected="$HOME/double.expected"
  printf 'aa if(!o.dev){ bb if(!i.dev){ cc' >"$target"
  cp "$target" "$expected"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 1 ]
  [[ "$output" == *"skip (ambiguous: 2 match(es), expected 1)"* ]]
  cmp -s "$target" "$expected"
  [ ! -f "$target.unpatched" ]
}

@test "--reapply on an ambiguous target warns, marks and exits zero" {
  local wrapper target expected marker="$HOME/.cache/test-needle-patch.stale"
  wrapper="$(write_literal_patch_wrapper "'if(!%s.dev){'" "'if(0&&%s.d){'" \
    $'local needle_kind=slots\nlocal same_length=1\nlocal expect_matches=1')"
  target="$HOME/double.bundle"
  expected="$HOME/double.expected"
  printf 'aa if(!o.dev){ bb if(!i.dev){ cc' >"$target"
  cp "$target" "$expected"

  run_zsh_function "$wrapper" --reapply "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE AMBIGUOUS"* ]]
  [[ "$output" != *"NEEDLE NOT FOUND"* ]]
  [ -f "$marker" ]
  grep -qF 'reason: the needle matched 2 site(s), expected 1' "$marker"
  cmp -s "$target" "$expected"
}

@test "with expect_matches unset a two-site needle still replaces both" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'function %s(e){legacy}'" "'function %s(e){patched}'" \
    $'local needle_kind=slots\nlocal same_length=0')"
  target="$HOME/two-site.bundle"
  printf 'aa function a7s(e){legacy} bb function xC(e){legacy} cc' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 0 ]
  [[ "$output" == *"(2 occurrence(s);"* ]]
  grep -qF 'aa function a7s(e){patched} bb function xC(e){patched} cc' "$target"
}

@test "a non-positive expect_matches exits 2 and leaves the target untouched" {
  local wrapper target
  wrapper="$(write_literal_patch_wrapper "'BEFORE'" "'AFTER'" \
    $'local same_length=0\nlocal expect_matches=0')"
  target="$HOME/app.bundle"
  printf 'BEFORE' >"$target"

  run_zsh_function "$wrapper" "$target"

  [ "$status" -eq 2 ]
  [[ "$output" == *"expect_matches: expected 'any' or a positive integer"* ]]
  grep -qF 'BEFORE' "$target"
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
