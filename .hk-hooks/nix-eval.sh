#!/usr/bin/env bash
# nix-eval: evaluate every host configuration's .drvPath so a config authored
# on one host can't silently break another (eval is platform-independent - a
# Linux homeConfiguration evaluates fine from macOS and vice versa; ~25s for
# all targets). Single source of the target list; CI reuses it via
# `hk check --all`. Escape hatch: HK_SKIP_STEPS=nix-eval git commit ...
set -euo pipefail

# hk exports GIT_DIR/GIT_WORK_TREE for the dotfiles bare-repo layout. Nix's
# flake fetcher must keep treating ~/.config/nix as a plain path, not a git
# work-tree rooted at $HOME, so drop them before calling nix.
unset GIT_DIR GIT_WORK_TREE

targets=(
	'darwinConfigurations."Connors-MacBook-Air".system'
	'darwinConfigurations."Connors-Mac-mini".system'
	'homeConfigurations."connor@penguin".activationPackage'
	'homeConfigurations."connor@dev".activationPackage'
	'homeConfigurations."connor@rpi5".activationPackage'
	'homeConfigurations."codespace".activationPackage'
)

# Relative on purpose: hk runs steps from the work-tree root, which is $HOME
# locally but the checkout dir in CI.
cd .config/nix
for t in "${targets[@]}"; do
	echo "eval $t" >&2
	nix eval --raw ".#${t}.drvPath" >/dev/null
done
