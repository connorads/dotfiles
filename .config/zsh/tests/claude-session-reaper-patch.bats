#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

REAPER_PATCH="$FUNCTIONS_DIR/claude/claude-session-reaper-patch"
MARKER_REL=".cache/claude-session-reaper-patch.stale"

setup() {
  setup_test_home
  mkdir -p "$HOME/.cache" "$HOME/.config/zsh/functions"
  ln -s "$FUNCTIONS_DIR/patch" "$HOME/.config/zsh/functions/patch"
  UNPATCHED_CURRENT='function _E(e){if(e<=1)return!1;try{return process.kill(e,0),!0}catch{return!1}}'
  PATCHED_CURRENT='function _E(e){try{return e>1&&process.kill(e,0)}catch(t){return e>1&t.errno<2}}'
  UNPATCHED_OLD='function Jk(e){if(e<=1)return!1;try{return process.kill(e,0),!0}catch{return!1}}'
  PATCHED_OLD='function Jk(e){try{return e>1&&process.kill(e,0)}catch(t){return e>1&t.errno<2}}'
}

@test "--reapply patches an unpatched bundle and clears the stale marker" {
  printf 'prefix %s suffix' "$UNPATCHED_CURRENT" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  grep -qF "$PATCHED_CURRENT" "$HOME/claude"
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply preserves the current minified helper name" {
  printf 'prefix %s suffix' "$UNPATCHED_OLD" >"$HOME/claude"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"patched:"* ]]
  grep -qF "$PATCHED_OLD" "$HOME/claude"
}

@test "--reapply on an already-patched bundle is a no-op and clears the marker" {
  printf 'prefix %s suffix' "$PATCHED_CURRENT" >"$HOME/claude"
  : >"$HOME/$MARKER_REL"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"already patched"* ]]
  [ ! -f "$HOME/$MARKER_REL" ]
}

@test "--reapply re-patches after a --restore" {
  printf 'prefix %s suffix' "$UNPATCHED_CURRENT" >"$HOME/claude"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED_CURRENT" "$HOME/claude"

  run_zsh_function "$REAPER_PATCH" --restore "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$UNPATCHED_CURRENT" "$HOME/claude"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"
  [ "$status" -eq 0 ]
  grep -qF "$PATCHED_CURRENT" "$HOME/claude"
}

@test "--reapply warns and writes a marker when the needle is gone, exiting 0" {
  printf 'prefix function aE_RENAMED(e){return false} suffix' >"$HOME/claude"

  run_zsh_function "$REAPER_PATCH" --reapply "$HOME/claude"

  [ "$status" -eq 0 ]
  [[ "$output" == *"NEEDLE NOT FOUND"* ]]
  [ -f "$HOME/$MARKER_REL" ]
  grep -qF "$HOME/claude" "$HOME/$MARKER_REL"
}
