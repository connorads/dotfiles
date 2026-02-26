# AGENTS.md

## Dotfiles Git Dir + Work-tree

Dotfiles are tracked with a dedicated git dir at `~/git/dotfiles` and work-tree `~`.
This is the same no-symlink pattern, exposed via the `dotfiles` wrapper.

**Command pattern:**
```bash
dotfiles <command>
```

Examples:
- `dotfiles status`
- `dotfiles add .file`
- `dotfiles commit -m "message"`

The `dotfiles` wrapper (installed via Nix) handles the git-dir/work-tree flags and resolves home directory reliably even in sanitised environments.

**Adding new files:** The `~/.gitignore` ignores everything (`/*`) then un-ignores specific paths. Before tracking a new file, add an un-ignore pattern to `~/.gitignore`:
```bash
# For a single file
!/.newfile

# For a directory (un-ignore dir, then its contents)
!/.config/newdir/
!/.config/newdir/**
```
Then `dotfiles add .newfile` works without `-f`.

## Git Hygiene

- Ignore unrelated git changes; do not reset/revert/discard them.

## Key Documentation

- [~/README.md](./README.md) - how the dotfiles system works (git-dir + work-tree, nix-darwin, home-manager)
- [connorads/rpi5](https://github.com/connorads/rpi5) - RPi5 NixOS configuration (standalone repo)

## Configuration Files

| File | Purpose |
|------|---------|
| [flake.nix](./.config/nix/flake.nix) | Main Nix config: macOS (nix-darwin), Linux (home-manager) |
| [config.toml](./.config/mise/config.toml) | mise tools (gh, opencode, etc.) |
| [.zshrc](./.zshrc) | Shell config with aliases and autoloaded helpers (nix/git/tailscale) |
| [.zshrc.local.example](./.zshrc.local.example) | Template for machine-local secrets in `~/.zshrc.local` |
| [kitty.conf](./.config/kitty/kitty.conf) | Terminal emulator config |
| [tmux.conf](./.config/tmux/tmux.conf) | tmux configuration (update `help.md` when changing bindings) |
| [help.md](./.config/tmux/help.md) | tmux keybindings cheatsheet (`Ctrl+b ?`) |
| [init.lua](./.config/nvim/init.lua) | Neovim configuration |
| [~/.config/zsh/functions/](./.config/zsh/functions/) | Custom shell functions (autoloaded in zsh, also on PATH as executables) |
| [~/.local/bin/](./.local/bin/) | Symlinks to dual-mode zsh functions (callable from any shell/agent) |
| [~/.config/zsh/aliases/](./.config/zsh/aliases/) | Tool-specific aliases (sourced from `.zshrc`) |
| [~/.config/webmux/webmux.config.ts](./.config/webmux/webmux.config.ts) | webmux config (package: [connorads/webmux](https://github.com/connorads/webmux)) |

## Shell Function Conventions

### Dual-mode functions (PATH commands)

Most functions in `~/.config/zsh/functions/` are **dual-mode**: they work as zsh autoload functions in interactive shells AND as regular executables callable from any shell (bash, agent subprocesses, scripts).

**Shebang = opt-in to PATH**: a `#!/usr/bin/env zsh` shebang on line 1 marks a function as dual-mode. `zfn-link` creates symlinks in `~/.local/bin/` for every file with this shebang, so agents can call them directly without `zsh -lc`.

**File structure:**
```
#!/usr/bin/env zsh           # ← present = dual-mode (PATH command)
# <name>: <purpose>
# alias: <alias>             # if applicable
emulate -L zsh               # ← ensures consistent zsh behaviour as script
...
```

**When to add shebang (dual-mode):** Add when the function does NOT:
- `cd` into a directory (would affect calling script, not caller's shell)
- `export` variables into the caller's environment
- `source` files into the caller's shell
- Use `print -z` (zsh command buffer injection)
- Define completions (`compdef`, `compadd`, `add-zsh-hook`, `_*` prefix)

**Zsh-only functions** (no shebang, autoload only):

| Function | Reason |
|----------|--------|
| `takedir`, `takegit`, `takeurl`, `takezip`, `take`, `mkcd` | `cd` |
| `ghcl`, `wta`, `wts` | `cd` |
| `y` | `cd` |
| `secretexport` | `export` |
| `zshrc-local` | `source` |
| `fns`, `cpcmd` | `print -z` |
| `_register_tmux_completions`, `_tmux_sessions` | completion/hook |

### Managing symlinks

```bash
zfn-link              # sync ~/.local/bin/ symlinks (after adding/removing shebangs)
zfn-link --dry-run    # preview changes without applying
zfn-link --verbose    # show each created/removed/unchanged symlink
```

Run `zfn-link` and commit after adding a shebang to a new function.

### Agent usage

Agents can call these commands directly — no `zsh -lc` wrapper needed:
```bash
bash -c 'ts status'       # works via ~/.local/bin/ts
bash -c 'killport 3000'   # works via ~/.local/bin/killport
```

Interactive zsh: autoload takes precedence over PATH (`whence -w killport` → `function`).

### Other conventions

- Add a top-of-function comment in `~/.config/zsh/functions/**` using `# <name>: <purpose>` (and `# alias: ...` when needed).
- oh-my-zsh git plugin defines ~200 `g*` aliases (e.g. `gcl`, `gco`, `gca`). Run `alias <name>` before creating new `g*` functions/aliases to avoid conflicts.

## Scripts

- [install.sh](./install.sh) - Bootstrap script for new machines

## Nix Targets

```
darwinConfigurations."Connors-Mac-mini"  # macOS via nix-darwin + home-manager
homeConfigurations."connor@penguin"      # Chromebook Linux
homeConfigurations."connor@dev"          # Remote aarch64 Linux
homeConfigurations."codespace"           # GitHub Codespaces (minimal)
# RPi5 NixOS config: github.com/connorads/rpi5
```

## Common Commands

```bash
drs                    # darwin-rebuild switch (macOS)
hms                    # home-manager switch (Linux)
nfu                    # nix flake update
dotfiles add .file     # Track new file (after un-ignoring in ~/.gitignore)
dotfiles status        # See changes
dhk check              # Run hk checks in dotfiles repo
dhk fix                # Run hk fixes in dotfiles repo
ts                     # Tailscale wrapper (defined in .zshrc)
toadup [port]          # Start toad web UI via Tailscale (default :8000)
toaddown               # Stop toad web UI
gigaup [port]              # Start gigacode server via Tailscale (default :2468, inspector at /ui/)
gigadown                   # Stop gigacode server
companionup [port]         # Start Vibe Companion via Tailscale (default :3456)
companiondown              # Stop Vibe Companion
webtermup [session] [port] # Expose tmux session via web (default: main :7681)
webtermdown [port]         # Stop web terminal
ghcl [owner]           # fzf clone from GitHub (SSH)
```

## Git Hooks (hk)

Dotfiles commit hooks are tracked in `~/.hk-hooks/` and configured via:

```bash
dotfiles config core.hooksPath .hk-hooks
```

The pre-commit hook runs `hk run pre-commit` using `hk.pkl` at `~/hk.pkl`.

## Agent Skills

Skills stored canonically in `~/.agents/skills/` and symlinked to all agent tools via `skillsync`. Both canonical files and symlinks are tracked in dotfiles.

Bookmarked skills live in `~/.agents/README.md` (references only, not installed).

**Installing skills:**
```bash
# Via CLI (preferred)
skills add vercel-labs/agent-skills -g  # Install from repo globally

# Manual (when skill isn't packaged or needs fetching)
mkdir -p ~/.agents/skills/<skill-name>
# Fetch/write SKILL.md (and any referenced files) to that directory
skillsync  # Creates symlinks to claude, cursor, codex, gemini, opencode, etc.
```

## Tailscale

**Always use `ts` wrapper, never raw `tailscale`** — it handles socket paths across platforms:

```bash
ts status                    # List devices
ts ssh connor@rpi5 'cmd'     # SSH via Tailscale
tsserve                      # Show active serve/funnel status
tsserveup [--public] [port]  # Serve port on Tailnet (or publicly with --public)
tsservedown [port]           # Tear down a served port
```

### Serve port registry

Each service uses a dedicated external HTTPS port so multiple services can coexist:

| Service | Function | Local port | External HTTPS |
|---------|----------|-----------|----------------|
| webterm | `webtermup` | 7681 | **443** (apex) |
| toad | `toadup` | 8000 | 8000 |
| gigacode | `gigaup` | 2468 | 2468 |
| companion | `companionup` | 3456 | 3456 |

Pattern: `ts serve --bg --https=$port $port` — `webtermup` is the exception, omitting `--https=` to claim the apex `:443`.

### Public access options

- **Tailscale funnel** (public internet): `tsserveup --public [port]`
- **Cloudflared quick tunnel** (unauthenticated, ephemeral): `cloudflared tunnel --url http://localhost:PORT`

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

### Pattern for dotfiles git commands over SSH

```bash
# Dotfiles commands on remote hosts (works in non-interactive SSH)
ssh host 'git --git-dir=$HOME/git/dotfiles --work-tree=$HOME <cmd>'
ts ssh connor@rpi5 'git --git-dir=$HOME/git/dotfiles --work-tree=$HOME pull'
```

## Keeping Docs Updated

After making significant changes (new config files, architectural changes, new scripts), update the relevant documentation:
- This file (`AGENTS.md`) - for new key files or commands
- [README.md](./README.md) - for changes to the dotfiles system itself
