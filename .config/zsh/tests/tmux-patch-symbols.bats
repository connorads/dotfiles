#!/usr/bin/env bats

# Fast guard that the tmux on PATH is the locally patched build. A rebuild that
# silently drops a patch from ~/.config/nix/patches/ still produces a working
# tmux, so nothing else fails until a human notices the dim/split-status is
# gone - or worse, until behaviour differs from what tmux-render-smoke.bats
# assumes it exercised. Complements hk's flake.nix grep (which checks the
# patches are *listed*) by checking the *installed binary* actually carries the
# compiled symbols. Deliberately not integration-tagged: nm on one binary is
# cheap enough for zsh-tests-fast. TMUX_BIN can override the binary under test.

setup() {
  TMUX_BIN="${TMUX_BIN:-$(command -v tmux || true)}"
  [ -n "$TMUX_BIN" ] || skip "tmux not installed"
  command -v nm >/dev/null 2>&1 || skip "nm unavailable"
}

@test "tmux binary carries the dim-inactive-panes patch (colour_dim)" {
  nm "$TMUX_BIN" | grep -q '_colour_dim'
}

@test "tmux binary carries the split-status patch (status_split_top_bottom)" {
  nm "$TMUX_BIN" | grep -q '_status_split_top_bottom'
}
