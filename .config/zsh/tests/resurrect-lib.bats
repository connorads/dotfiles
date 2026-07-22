#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

# Captured against the real HOME at file-load, before setup_test_home swaps it
# for an isolated temp dir. The lib reads its save dir from $HOME at call time
# (resurrect_dir), so sourcing the real file against the isolated HOME is correct.
RES_LIB="$HOME/.config/tmux/scripts/resurrect-lib.sh"

setup() {
  setup_test_home
}

# The plugin-default save dir under the isolated HOME (no ~/.tmux/resurrect, so
# resurrect_dir resolves to the XDG path).
save_dir() { echo "$HOME/.local/share/tmux/resurrect"; }

# A resurrect save file at mtime = now (FRESH).
mk_fresh_save() {
  mkdir -p "$(save_dir)"
  touch "$(save_dir)/tmux_resurrect_${1:-now}.txt"
}

# A resurrect save file at a fixed far-past mtime (large age). touch -t uses an
# absolute timestamp, so it is BSD/GNU portable and deterministic regardless of
# now — the age band is then selected by flexing the RESURRECT_*_SECS thresholds.
mk_aged_save() {
  mkdir -p "$(save_dir)"
  touch -t 200001010000 "$(save_dir)/tmux_resurrect_${1:-old}.txt"
}

lib() {
  run bash -c "source '$RES_LIB'; $*"
}

# --- resurrect_dir default resolution --------------------------------------

@test "resurrect_dir prefers ~/.tmux/resurrect when present" {
  mkdir -p "$HOME/.tmux/resurrect"
  lib resurrect_dir
  [ "$output" = "$HOME/.tmux/resurrect" ]
}

@test "resurrect_dir falls back to the XDG data path" {
  lib resurrect_dir
  [ "$output" = "$HOME/.local/share/tmux/resurrect" ]
}

@test "resurrect_dir honours XDG_DATA_HOME" {
  XDG_DATA_HOME="$HOME/xdg" lib resurrect_dir
  [ "$output" = "$HOME/xdg/tmux/resurrect" ]
}

# --- state mapping across the age bands ------------------------------------

@test "NONE when no save file exists" {
  mkdir -p "$(save_dir)"
  lib resurrect_state
  [ "$output" = "NONE" ]
}

@test "NONE when the save dir does not exist at all" {
  lib resurrect_state
  [ "$output" = "NONE" ]
}

@test "FRESH for a just-written save under the aging line" {
  mk_fresh_save
  lib resurrect_state
  [ "$output" = "FRESH" ]
}

@test "AGING when age crosses the aging line but not the stale line" {
  mk_aged_save
  RESURRECT_AGING_SECS=1 RESURRECT_STALE_SECS=999999999 lib resurrect_state
  [ "$output" = "AGING" ]
}

@test "STALE when age crosses the stale line (default thresholds, aged file)" {
  mk_aged_save
  lib resurrect_state
  [ "$output" = "STALE" ]
}

@test "aging line is inclusive, stale line exclusive at the boundary" {
  mk_aged_save
  # Age is huge; put the aging line just below it and the stale line just above.
  RESURRECT_AGING_SECS=1 RESURRECT_STALE_SECS=999999999 lib resurrect_state
  [ "$output" = "AGING" ]
  # Drop the stale line onto the age -> STALE takes over.
  RESURRECT_AGING_SECS=1 RESURRECT_STALE_SECS=1 lib resurrect_state
  [ "$output" = "STALE" ]
}

@test "newest of several files drives the state" {
  mk_aged_save old
  mk_fresh_save new
  lib resurrect_state
  [ "$output" = "FRESH" ]
}

# --- newest-age via the `last` symlink target ------------------------------

@test "age follows the last symlink to its target mtime, not the link's own" {
  mk_aged_save target
  ln -sf "tmux_resurrect_target.txt" "$(save_dir)/last"
  # The symlink was just created (fresh lstat mtime); dereferencing must yield
  # the aged target, so state is STALE under default thresholds.
  lib resurrect_state
  [ "$output" = "STALE" ]
}

# --- colour vocabulary ------------------------------------------------------

@test "each state maps to its catppuccin colour" {
  lib 'resurrect_state_colour FRESH'
  [ "$output" = "a6e3a1" ]
  lib 'resurrect_state_colour AGING'
  [ "$output" = "f9e2af" ]
  lib 'resurrect_state_colour STALE'
  [ "$output" = "f38ba8" ]
  lib 'resurrect_state_colour NONE'
  [ "$output" = "f38ba8" ]
}

# --- glyph vocabulary: healthy vs alarm shapes ------------------------------

@test "FRESH/AGING share the turning glyph, STALE/NONE the warning glyph" {
  lib 'resurrect_state_glyph FRESH'
  fresh="$output"
  lib 'resurrect_state_glyph AGING'
  aging="$output"
  lib 'resurrect_state_glyph STALE'
  stale="$output"
  lib 'resurrect_state_glyph NONE'
  none="$output"
  [ "$fresh" = "$aging" ]
  [ "$stale" = "$none" ]
  [ "$fresh" != "$stale" ]
}

# --- token: figure-slot content --------------------------------------------

@test "token is none when there is no save" {
  lib resurrect_token
  [ "$output" = "none" ]
}

@test "token is stale past the stale line" {
  mk_aged_save
  lib resurrect_token
  [ "$output" = "stale" ]
}

@test "token is the human age when fresh or aging" {
  mk_aged_save
  RESURRECT_AGING_SECS=1 RESURRECT_STALE_SECS=999999999 lib resurrect_token
  # A far-past file is many days old -> Nd.
  [[ "$output" =~ ^[0-9]+d$ ]]
}

# --- human age formatter ----------------------------------------------------

@test "human age renders seconds, minutes, hours and days" {
  lib 'resurrect_human_age 5'
  [ "$output" = "5s" ]
  lib 'resurrect_human_age 125'
  [ "$output" = "2m" ]
  lib 'resurrect_human_age 7200'
  [ "$output" = "2h" ]
  lib 'resurrect_human_age 172800'
  [ "$output" = "2d" ]
}
