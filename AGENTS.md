# AGENTS.md

## Bare Git Repo for Dotfiles

Dotfiles tracked via bare repo at `~/git/dotfiles` with work-tree `~`.

**Command pattern:**
```bash
dotfiles <command>
```

Examples:
- `dotfiles status`
- `dotfiles add -f .file`
- `dotfiles commit -m "message"`

The `dotfiles` wrapper (installed via Nix) handles the bare repo flags and resolves home directory reliably even in sanitised environments.

## Key Documentation

- [~/README.md](./README.md) - how the dotfiles system works (bare repo, nix-darwin, home-manager)
- [~/.config/nix/hosts/rpi5/README.md](./.config/nix/hosts/rpi5/README.md) - RPi5 NixOS installation & management
- [~/.config/nix/hosts/rpi5/CLAWDBOT.md](./.config/nix/hosts/rpi5/CLAWDBOT.md) - Clawdbot AI gateway setup on RPi5

## Configuration Files

| File | Purpose |
|------|---------|
| [flake.nix](./.config/nix/flake.nix) | Main Nix config: macOS (nix-darwin), Linux (home-manager), NixOS (rpi5) |
| [configuration.nix](./.config/nix/hosts/rpi5/configuration.nix) | RPi5 NixOS system config with Clawdbot, Tailscale, auto-updates |
| [clawdbot.json](./.clawdbot/clawdbot.json) | Clawdbot AI gateway config (RPi5) |
| [config.toml](./.config/mise/config.toml) | mise tools (gh, opencode, etc.) |
| [.zshrc](./.zshrc) | Shell config with aliases like `drs`, `hms`, `nrs`, tailscale helpers |
| [kitty.conf](./.config/kitty/kitty.conf) | Terminal emulator config |
| [tmux.conf](./.config/tmux/tmux.conf) | tmux configuration |
| [init.lua](./.config/nvim/init.lua) | Neovim configuration |

## Scripts

- [install.sh](./install.sh) - Bootstrap script for new machines
- [secrets-deploy.sh](./.config/nix/hosts/rpi5/secrets-deploy.sh) - Deploy secrets to RPi5 securely

## Nix Targets

```
darwinConfigurations."Connors-Mac-mini"  # macOS via nix-darwin + home-manager
homeConfigurations."connor@penguin"      # Chromebook Linux
homeConfigurations."connor@dev"          # Remote aarch64 Linux
homeConfigurations."codespace"           # GitHub Codespaces (minimal)
nixosConfigurations."rpi5"               # Raspberry Pi 5 NixOS
installerImages.rpi5                     # Pi 5 installer image
```

## Common Commands

```bash
drs                    # darwin-rebuild switch (macOS)
hms                    # home-manager switch (Linux)
nrs                    # nixos-rebuild switch (NixOS)
nfu                    # nix flake update
dotfiles add -f .file  # Track new file
dotfiles status        # See changes
ts                     # Tailscale wrapper (defined in .zshrc)
```

## Tailscale

Always use `ts` wrapper for Tailscale operations (not raw `tailscale` command):

```bash
ts status                    # List devices
ts ssh connor@rpi5 'cmd'     # SSH via Tailscale
```

For RPi5-specific commands (clawdbot, user services), see [CLAWDBOT.md](./.config/nix/hosts/rpi5/CLAWDBOT.md).

## Tracked Files

To list all tracked dotfiles:
```bash
dotfiles ls-files
```

## Remote Shell Execution

When executing commands on remote hosts (SSH, codespaces) where mise tools are needed:

### Pattern for non-interactive commands

```bash
ssh host 'zsh -c "source ~/.zshrc; your-command"'
gh codespace ssh -c name -- 'zsh -c "source ~/.zshrc; tmux capture-pane -t session -p"'
```

### Pattern for interactive sessions (needs TTY)

```bash
ssh host -t 'zsh -ilc "tmux attach -t session"'
gh codespace ssh -c name -- -t 'zsh -ilc "tmux attach -t session"'
```

**Why**: Default shell is often bash which doesn't have mise in PATH. Sourcing `~/.zshrc` activates mise shims.

**Avoid**: `zsh -lc` on its own can hang on some systems.

### Pattern for bare repo git commands over SSH

```bash
# Dotfiles commands on remote hosts (works in non-interactive SSH)
ssh host 'git --git-dir=$HOME/git/dotfiles --work-tree=$HOME <cmd>'
ts ssh connor@rpi5 'git --git-dir=$HOME/git/dotfiles --work-tree=$HOME pull'
```

## Keeping Docs Updated

After making significant changes (new config files, architectural changes, new scripts), update the relevant documentation:
- This file (`AGENTS.md`) - for new key files or commands
- [README.md](./README.md) - for changes to the dotfiles system itself
- [hosts/rpi5/README.md](./.config/nix/hosts/rpi5/README.md) - for RPi5 setup/management changes
- [hosts/rpi5/CLAWDBOT.md](./.config/nix/hosts/rpi5/CLAWDBOT.md) - for Clawdbot configuration changes
