#!/usr/bin/env bash
# nix-eval: evaluate every host configuration's .drvPath so a config authored
# on one host can't silently break another (eval is platform-independent - a
# Linux homeConfiguration evaluates fine from macOS and vice versa). Targets
# are derived from the flake's own `checks` attr (built from the config sets),
# so adding a host can't silently escape the check. CI reuses it via
# `hk check --all`. Escape hatch: HK_SKIP_STEPS=nix-eval git commit ...
set -euo pipefail

# hk exports GIT_DIR/GIT_WORK_TREE for the dotfiles bare-repo layout. Nix's
# flake fetcher must keep treating ~/.config/nix as a plain path, not a git
# work-tree rooted at $HOME, so drop them before calling nix.
unset GIT_DIR GIT_WORK_TREE

# Relative on purpose: hk runs steps from the work-tree root, which is $HOME
# locally but the checkout dir in CI.
cd .config/nix
nix eval --json .#checks --apply \
	'cs: builtins.mapAttrs (_: sys: builtins.mapAttrs (_: drv: drv.drvPath) sys) cs' >/dev/null
