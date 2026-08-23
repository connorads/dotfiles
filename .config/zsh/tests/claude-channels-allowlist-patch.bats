#!/usr/bin/env bats

# Consumer of the shared engine at functions/patch/_needle-patch-lib, and the
# only slot-mode one - so this suite is where the rename-absorption and the
# expect_matches=1 pin are held. It is also the wrapper's first suite: it was
# the one lib consumer with no coverage, which is why a 2.1.227 rename silently
# put the allowlist gate back.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ALLOWLIST_PATCH="$FUNCTIONS_DIR/claude/claude-channels-allowlist-patch"
MARKER_REL=".cache/claude-channels-allowlist-patch.stale"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"
  # The two minified names actually observed: 2.1.220 emitted `o`, 2.1.227
  # reminified the scope to `i`.
  NEEDLE_I='if(!i.dev){'
  PATCHED_I='if(0&&i.d){'
  NEEDLE_O='if(!o.dev){'
  PATCHED_O='if(0&&o.d){'
}

@test "--reapply patches the current minified name and clears the stale marker" {
  printf 'prefix %s suffix' "$NEEDLE_I" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  grep -qF "$PATCHED_I" "$HOME/claude"
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply absorbs a rename, patching the pre-2.1.227 name too" {
  printf 'prefix %s suffix' "$NEEDLE_O" >"$HOME/claude"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  grep -qF "$PATCHED_O" "$HOME/claude"
}

@test "--check reads either minified name as patched" {
  printf 'prefix %s suffix' "$PATCHED_O" >"$HOME/claude-o"
  printf 'prefix %s suffix' "$PATCHED_I" >"$HOME/claude-i"

  run_zsh_function "$ALLOWLIST_PATCH" --check "$HOME/claude-o" "$HOME/claude-i"

  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c '^patched:')" -eq 2 ]
}

@test "the patch is byte-length-preserving whatever the name's length" {
  local before after
  printf 'prefix if(!$aVeryLongMinifiedName_42.dev){ suffix' >"$HOME/claude"
  before=$(wc -c <"$HOME/claude")

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  grep -qF 'if(0&&$aVeryLongMinifiedName_42.d){' "$HOME/claude"
  after=$(wc -c <"$HOME/claude")
  [ "$before" -eq "$after" ]
}

@test "--reapply on an already-patched bundle is a no-op and clears the marker" {
  printf 'prefix %s suffix' "$PATCHED_I" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"already patched"* ]]
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply re-patches after a --restore" {
  printf 'prefix %s suffix' "$NEEDLE_I" >"$HOME/claude"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED_I" "$HOME/claude"

  run_zsh_function "$ALLOWLIST_PATCH" --restore "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$NEEDLE_I" "$HOME/claude"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED_I" "$HOME/claude"
}

@test "--reapply warns and writes a marker when the guard is reshaped, exiting 0" {
  # A rename alone is absorbed, so only a shape change can miss - here the
  # negation is gone.
  printf 'prefix if(i.isDev){ suffix' >"$HOME/claude"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  grep -qF "$HOME/claude" "$HOME/$MARKER_REL"
}

@test "a second gate site is ambiguous: refused, marked, target untouched" {
  printf 'prefix %s middle %s suffix' "$NEEDLE_O" "$NEEDLE_I" >"$HOME/claude"
  cp "$HOME/claude" "$HOME/claude.expected"

  run_zsh_function "$ALLOWLIST_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE AMBIGUOUS"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  cmp -s "$HOME/claude" "$HOME/claude.expected"

  run_zsh_function "$ALLOWLIST_PATCH" --check "$HOME/claude"

  [ "$status" -eq 1 ]
  [[ "$output" == *"ambiguous:"* ]]
}
