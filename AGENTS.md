# AGENTS.md

`~/CLAUDE.md` → `~/AGENTS.md` (project/dotfiles), `~/.claude/CLAUDE.md` → `~/.agents/AGENTS.md` (user). Canonical files are `AGENTS.md` — use `dotfiles add AGENTS.md` when committing changes.

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

| File                                                                   | Purpose                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [flake.nix](./.config/nix/flake.nix)                                   | Main Nix config: macOS (nix-darwin), Linux (home-manager)                                 |
| [config.toml](./.config/mise/config.toml)                              | mise tools (gh, opencode, etc.)                                                           |
| [.zshrc](./.zshrc)                                                     | Shell config with aliases and autoloaded helpers                                          |
| [.zshrc.local.example](./.zshrc.local.example)                         | Template for machine-local secrets in `~/.zshrc.local`                                    |
| [kitty.conf](./.config/kitty/kitty.conf)                               | Terminal emulator config                                                                  |
| [tmux.conf](./.config/tmux/tmux.conf)                                  | tmux configuration (update `help.md` when changing bindings)                              |
| [help.md](./.config/tmux/help.md)                                      | tmux keybindings cheatsheet (`Ctrl+b ?`)                                                  |
| [init.lua](./.config/nvim/init.lua)                                    | Neovim configuration                                                                      |
| [~/.config/zsh/functions/](./.config/zsh/functions/)                   | Custom shell functions (autoloaded in zsh, also on PATH as executables)                   |
| [~/.local/bin/](./.local/bin/)                                         | Symlinks to dual-mode zsh functions (callable from any shell/agent); includes `git-hunks` |
| [~/.local/bin/gh](./.local/bin/gh)                                     | `gh` wrapper that reads gh-gate tokens dynamically (not a symlink)                        |
| [~/.config/zsh/aliases/](./.config/zsh/aliases/)                       | Tool-specific aliases (sourced from `.zshrc`)                                             |
| [~/.config/remobi/remobi.config.ts](./.config/remobi/remobi.config.ts) | remobi config (package: [connorads/remobi](https://github.com/connorads/remobi))          |
| [gh-gate](./.config/zsh/functions/git/gh-gate)                         | Scoped gh CLI tokens via GitHub App (`gh-gate --help` for full setup)                     |
| [.rtk-shim](./.config/zsh/functions/agents/.rtk-shim)                  | RTK shim script: intercepts commands in agent contexts for token reduction                |
| [rtk-shims](./.config/zsh/functions/agents/rtk-shims)                  | Manager for RTK shim symlinks in `~/.local/lib/rtk-shims/`                               |

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

| Function                                           | Reason          |
| -------------------------------------------------- | --------------- |
| `takedir`, `takegit`, `takeurl`, `takezip`, `take` | `cd`            |
| `ghcl`, `wta`, `wts`                               | `cd`            |
| `y`                                                | `cd`            |
| `secretexport`                                     | `export`        |
| `zshrc-local`                                      | `source`        |
| `fns`, `cpcmd`                                     | `print -z`      |
| `_register_tmux_completions`, `_tmux_sessions`     | completion/hook |

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
homeConfigurations."connor@rpi5"         # Raspberry Pi 5 (aarch64, server packages, user env only)
homeConfigurations."codespace"           # GitHub Codespaces (minimal)
# RPi5 NixOS system config: github.com/connorads/rpi5
```

### Hybrid NixOS (rpi5)

The rpi5 uses a hybrid setup — two repos, two rebuilds:

- **System** (`nrs`): NixOS config from `~/git/rpi5` (set via `NIXOS_FLAKE` in `.zshrc.local`)
- **User env** (`hms`): shell, tools, git, tmux etc. from dotfiles (`~/.config/nix`)

The `up` function runs both on NixOS. An agent on rpi5 can modify the system config (rpi5 repo) without touching dotfiles.

## Common Commands

```bash
drs                    # darwin-rebuild switch (macOS)
hms                    # home-manager switch (Linux)
nrs                    # nixos-rebuild switch (reads $NIXOS_FLAKE, default: ~/.config/nix)
nrsr                   # nixos-rebuild switch --rollback
up                     # update everything: mise, brew/apt, flake lock, rebuild (NixOS: nrs + hms)
nfu                    # nix flake update
dotfiles add .file     # Track new file (after un-ignoring in ~/.gitignore)
dotfiles status        # See changes
dhk check              # Run hk checks in dotfiles repo
dhk fix                # Run hk fixes in dotfiles repo
ts                     # Tailscale wrapper (defined in .zshrc)
svc ls                 # List agent services with status
svc up <name> [port]   # Start service + expose via Tailscale
svc down <name>        # Stop service + teardown Tailscale route
svc restart <name>     # Restart a service
svc ui                 # fzf service picker (default in TTY)
wt-add <branch>        # Create worktree under ~/.trees, run rs, print path (agent-callable)
wta <branch>           # wt-add + cd into it (human workflow)
wti                    # Show all worktrees with branch, dirty/clean, ahead/behind
wts                    # fzf switch to a worktree (works outside git repos)
wtrm [path]            # Remove worktree (--force, --branch flags; fzf if no path)
wtmerge                # Two-phase merge worktree branch back to main
ghcl [owner]           # fzf clone from GitHub (SSH)
gh-gate init           # Create read-only PAT and deploy to dev (opens browser)
gh-gate grant          # Push 1-hour write token to dev (from host machine)
gh-gate revoke         # Revoke write token, restore read-only on dev
gh-gate status         # Check token state on dev
rtk-shims sync         # Create/update RTK agent shims (default)
rtk-shims list         # Show current shims with status
rtk-shims clean        # Remove all shims and the directory
```

## Supply Chain & Update Strategy

Mise tools use a **14-day quarantine** (`install_before = "14d"`) — only versions released 14+ days ago are installed. This gives the community time to catch compromised releases (the Trivy hack was caught within days). GitHub attestation and SLSA provenance verification are also enabled.

**Version ranges, not "latest"**: tools are pinned to major or major.minor ranges (e.g., `deno = "2"`, `pkl = "0.31"`). `mise upgrade` pulls patches within the range; `--bump` crosses boundaries. Claude and Codex are exempted from quarantine in `up`.

**How `up` works**: upgrades mise tools within ranges (14-day quarantine), exempts Claude (always latest), updates brew/apt, optionally updates nix flake lock, rebuilds. `-s` skips nix flake update.

```bash
up                                          # full update (quarantined mise + brew/apt + nix + rebuild)
up -s                                       # skip nix flake update
mise upgrade --bump [tool]                  # cross version boundaries (still 14-day quarantine)
mise upgrade --bump --before 0d [tool]      # skip quarantine for urgent updates
mise outdated                               # available updates within ranges
mise outdated --bump                        # available updates beyond ranges
```

**pnpm**: global 14-day quarantine (`minimum-release-age=20160`) + trust policy (`trust-policy=no-downgrade`) in `~/.config/pnpm/rc`. Applies to all projects. `trustPolicy` blocks installs where a package's trust level has decreased (e.g., Trusted Publisher → unsigned = likely compromise).

**uv**: global 14-day quarantine (`exclude-newer = "14 days"`) in `~/.config/uv/uv.toml`. Applies during resolution (`uv lock`/`uv lock --upgrade`), not during `uv sync --frozen`.

**No mise lockfile** (yet): `mise.lock` has multi-platform issues — `mise upgrade --bump` only updates the current platform's entries. Revisit when mise rewrites the lockfile system.

**Nix**: flake.lock is the checkpoint. `nfu` updates it; `up` commits it. nixpkgs-unstable is correct for macOS (NixOS integration tests are irrelevant for nix-darwin).

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
tsp ls                       # Show active serve/funnel status (+ stale targets)
tsp up [port]                # Serve port on Tailnet
tsp down [https-port]        # Tear down a served port
tsp prune --dry-run          # Preview stale served routes
```

### Serve port registry

Each service uses a dedicated external HTTPS port so multiple services can coexist:

| Service   | `svc` name  | Local port | External HTTPS |
| --------- | ----------- | ---------- | -------------- |
| remobi    | `remobi`    | 7681       | **443** (apex) |
| toad      | `toad`      | 8000       | 8000           |
| gigacode  | `gigacode`  | 2468       | 2468           |
| companion | `companion` | 3456       | 3456           |

Pattern: `ts serve --bg --https=$port $port` — remobi is the exception, omitting `--https=` to claim the apex `:443`.

### Public access options

- **Tailscale funnel** (public internet): `tsp up --public [port]`
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
