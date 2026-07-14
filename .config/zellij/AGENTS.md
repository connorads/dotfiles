# AGENTS.md - zellij config

## Overview

zellij is a terminal multiplexer installed via Nix (the host-global ownership
model, same as tmux - see `~/.config/nix/modules/packages.nix` `corePackages`).
This config dir is tracked in dotfiles; runtime state (session cache, downloaded
plugins, logs) lives in `~/.cache/zellij/` and `~/.local/share/zellij/`, which
are **not** tracked.

The config is intentionally minimal - it overrides only theme, scrollback, and
the release-notes popup. Everything else (keybinds, mouse, OSC 52 copy, default
shell, layouts, built-in plugins) is the zellij default.

## Files

| File | Purpose |
| ---- | ------- |
| [config.kdl](./config.kdl) | Main config (KDL). Overrides only; defaults live in the binary at `zellij-utils/assets/config/default.kdl`. |
| `layouts/` | Custom layouts (KDL). Empty - zellij's `default` layout is used. Add files here to define named layouts. |
| `themes/` | Custom themes (KDL). Empty - Catppuccin is built into zellij, so no theme file is needed. |

## Ownership vs tmux

zellij and tmux coexist. tmux remains the primary multiplexer (patched binary,
agent-dots/AI-usage/memory subsystems, resurrect). zellij is a standalone
alternative with no shared hooks into those subsystems - porting them would be
a from-scratch effort against zellij's WebAssembly plugin API, not a copy.

## Rebuild

```bash
drs   # darwin-rebuild switch (macOS) - installs the zellij package
hms   # home-manager switch (Linux)
```

Config changes (config.kdl) are live-reloadable: `zellij action ...` or just
restart the session. No rebuild needed for config-only edits.

## Conventions

- Keep overrides minimal and commented with **why** (not what). The defaults
  are documented in zellij's default.kdl; this file only records divergence.
- The Catppuccin Mocha theme must stay in sync with kitty.conf and the tmux
  status palette - all three surfaces share one look.
