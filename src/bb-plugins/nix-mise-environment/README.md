# Nix Mise Environment

Gives Codex threads this Mac's login-shell environment, so Nix tools and
per-directory mise tool versions resolve. Without it, Codex finds no `node`,
`uv` or `pnpm` and falls back to macOS's `/usr/bin/python3`.

## How it works

1. On load, the plugin runs a clean login shell (`zsh -l`, which skips `.zshrc`)
   and reads its environment.
2. It keeps an allow-list of non-secret variables: `PATH`, Nix variables,
   `XDG_*_DIRS`, `TERMINFO_DIRS`, `EDITOR` and `PAGER`.
3. It orders `PATH` as `~/.local/bin`, then mise shims, then the rest. Shims pick
   each directory's mise tool versions.
4. It contributes these to Codex processes on the configured host only.

Reload the plugin after changing the login environment. Existing Codex threads
keep their launch environment until restarted.

## Setup

The host ID is a live setting, kept out of this public repository:

```zsh
bb plugin config nix-mise-environment set hostId "$(bb host list --json | jq -r '.[0].id // .hosts[0].id')"
```

With no host ID, the plugin contributes nothing.

## Checks

```zsh
pnpm test        # shaping rules, and this machine's login shell resolving node through shims
pnpm typecheck
pnpm build
```

To compare live behaviour, start a Codex thread and run `command -v node uv` in
a directory with a `mise.toml`. Then repeat with the plugin disabled.
