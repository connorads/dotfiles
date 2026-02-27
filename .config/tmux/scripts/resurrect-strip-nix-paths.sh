#!/usr/bin/env bash
# resurrect-strip-nix-paths.sh: post-save hook for tmux-resurrect
# Strip /nix/store/<hash>/bin/ prefixes from saved process names so that
# session restore works after nix-collect-garbage or flake updates.
# Without this, tmux-resurrect can't find executables whose store paths changed.
# ref: https://discourse.nixos.org/t/30819
SAVE_FILE="$1"
[[ -f "$SAVE_FILE" ]] || exit 0

# macOS (BSD) sed requires '' for -i; GNU sed doesn't
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' 's|/nix/store/[^/]*/bin/||g' "$SAVE_FILE"
else
  sed -i 's|/nix/store/[^/]*/bin/||g' "$SAVE_FILE"
fi
