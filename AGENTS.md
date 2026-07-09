# AGENTS.md

`~/CLAUDE.md` → `~/AGENTS.md` (project/dotfiles), `~/.claude/CLAUDE.md` → `~/.agents/AGENTS.md` (user). Canonical files are `AGENTS.md` - use `dotfiles add AGENTS.md` when committing changes.

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
- Treat Codex `[projects.*]` trust entries and model picker keys (`model`, `model_reasoning_effort`, `plan_mode_reasoning_effort`) in [`.codex/config.toml`](./.codex/config.toml) as machine-local state; never commit them. A `codex-config` clean filter strips or normalises them on commit.
- Treat Pi model picker keys (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`) in [`.pi/agent/settings.json`](./.pi/agent/settings.json) as machine-local state; never commit them. A `pi-agent-settings` clean filter normalises them and restores the final newline on commit.
- Treat the `model` key in [`.claude/settings.json`](./.claude/settings.json) as machine-local state - Claude Code's `/model` picker writes it back with no opt-out (since v2.1.153; `s` in the picker is session-only). A `claude-settings` clean filter strips it on commit.
- Use `dotfiles` commands for dotfiles git operations so config renormalisation (Codex, Claude, and Pi settings clean filters) runs before status/diff/stash.

## Key Documentation

- [~/README.md](./README.md) - how the dotfiles system works (git-dir + work-tree, nix-darwin, home-manager)
- [connorads/rpi5](https://github.com/connorads/rpi5) - RPi5 NixOS configuration (standalone repo)

## Configuration Files

| File                                                                   | Purpose                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [flake.nix](./.config/nix/flake.nix)                                   | Main Nix config: macOS (nix-darwin), Linux (home-manager)                                 |
| [modules/biokc.nix](./.config/nix/modules/biokc.nix)                   | Builds `biokc` (Touch ID keychain helper) from [`main.swift`](./.config/nix/biokc/main.swift) via system swiftc; desktop-only. Used by gh-gate to fingerprint-gate the key |
| [config.toml](./.config/mise/config.toml)                              | mise tools (gh, opencode, etc.)                                                           |
| [.config/srt/base.json](./.config/srt/base.json)                       | `agent-sandbox` (`asb`) srt policies: opt-in OS sandbox for CLI agents. Subsystem docs: [.config/srt/AGENTS.md](./.config/srt/AGENTS.md) |
| [.config/sbx/Dockerfile](./.config/sbx/Dockerfile)                     | Image for `sbx` ([zsh/functions/agents/sbx](./.config/zsh/functions/agents/sbx)): VM-isolated (colima) container for running UNTRUSTED software. Inverse of `agentbox` - no host mounts, cap-drop ALL, offline by default. Capable toolbox baked in (build/net/trace tools); no host dotfiles |
| [.npmrc](./.npmrc)                                                     | npm quarantine (`min-release-age`, in days), Git dependency block (`allow-git=none`); also read by Deno npm installs |
| [.config/pnpm/config.yaml](./.config/pnpm/config.yaml)                 | pnpm 11 quarantine + trust-policy + ignore-scripts (YAML). macOS reads it via a nix-managed symlink at `~/Library/Preferences/pnpm/config.yaml` ([darwin-shared.nix](./.config/nix/modules/darwin-shared.nix)) |
| [.bunfig.toml](./.bunfig.toml)                                         | bun quarantine (`minimumReleaseAge`, in seconds) for direct `bun` use. Must live at `$HOME` - XDG path is ignored on bun 1.3.14 (oven-sh/bun#26408) |
| [.config/pip/pip.conf](./.config/pip/pip.conf)                         | pip quarantine (`uploaded-prior-to = P4D`) for direct `pip install` / `download` / `wheel` |
| [.yarnrc.yml](./.yarnrc.yml)                                           | Modern Yarn quarantine (`npmMinimalAgeGate: 4d`). Yarn 1 ignores this; prefer pnpm there |
| [.config/aube/config.toml](./.config/aube/config.toml)                 | aube quarantine + trustPolicy + low-download gate + advisoryBloomCheck. Primary npm backend for mise (`npm.package_manager = "aube"`) |
| [.zshrc](./.zshrc)                                                     | Shell config with aliases and autoloaded helpers                                          |
| [.zshrc.local.example](./.zshrc.local.example)                         | Template for machine-local secrets in `~/.zshrc.local`                                    |
| [kitty.conf](./.config/kitty/kitty.conf)                               | Terminal emulator config                                                                  |
| [tmux.conf](./.config/tmux/tmux.conf)                                  | tmux configuration · maintenance: [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md)       |
| [help.md](./.config/tmux/help.md)                                      | tmux keybindings cheatsheet (`Ctrl+b ?`)                                                  |
| [claude-watcher/README.md](./.config/claude-watcher/README.md)         | Per-pane Claude auto-continue watcher (arm/disarm via `prefix + T` Tools or pane context menu); design + env vars   |
| [tmux/scripts/mem-lib.sh](./.config/tmux/scripts/mem-lib.sh)            | Memory-pressure vocabulary (OK/BUSY/CRITICAL) shared by the status gauge, `prefix + Alt+m` popup, and `memwatch`; subsystem docs in [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [zsh/functions/macos/memwatch](./.config/zsh/functions/macos/memwatch) | Desktop-only launchd notifier ([darwin-desktop.nix](./.config/nix/modules/darwin-desktop.nix)); banners on sustained pressure. Log `~/.cache/memwatch.log`; reload `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"` |
| [init.lua](./.config/nvim/init.lua)                                    | Neovim configuration                                                                      |
| [config.json](./.config/fresh/config.json)                             | Fresh terminal IDE configuration; local theme/help live under `~/.config/fresh/`           |
| [.fresh/config.json](./.fresh/config.json)                             | Fresh project config for this dotfiles work-tree (shows hidden files from `~`)             |
| [~/.config/zsh/functions/](./.config/zsh/functions/)                   | Custom shell functions (autoloaded in zsh, also on PATH as executables)                   |
| [~/.local/bin/](./.local/bin/)                                         | Symlinks to dual-mode zsh functions (callable from any shell/agent); includes `git-hunks` |
| [~/.local/bin/gh](./.local/bin/gh)                                     | `gh` wrapper; normal keyring auth unless gh-gate token files exist                       |
| [~/.config/zsh/aliases/](./.config/zsh/aliases/)                       | Tool-specific aliases (sourced from `.zshrc`)                                             |
| [~/.config/remobi/remobi.config.ts](./.config/remobi/remobi.config.ts) | remobi config (package: [connorads/remobi](https://github.com/connorads/remobi))          |
| [~/src/raycast/shotpath](./src/raycast/shotpath)                       | Local Raycast extension wrapping the `shotpath` command; kept outside dot dirs because Raycast rejects hidden development source paths |
| [gh-gate](./.config/zsh/functions/git/gh-gate)                         | Scoped gh CLI tokens via GitHub App (`gh-gate --help` for full setup); key is Touch ID-gated via biokc on the desktop |

## Shell Function Conventions

### Dual-mode functions (PATH commands)

Most functions in `~/.config/zsh/functions/` are **dual-mode**: they work as zsh autoload functions in interactive shells AND as regular executables callable from any shell (bash, agent subprocesses, scripts).

**Shebang = opt-in to PATH**: a `#!/usr/bin/env zsh` shebang on line 1 marks a function as dual-mode. `zfn-link` creates symlinks in `~/.local/bin/` for every file with this shebang, so agents can call them directly without `zsh -lc`.

**File structure:**

```text
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

Agents can call these commands directly - no `zsh -lc` wrapper needed:

```bash
bash -c 'ts status'       # works via ~/.local/bin/ts
bash -c 'killport 3000'   # works via ~/.local/bin/killport
```

Interactive zsh: autoload takes precedence over PATH (`whence -w killport` → `function`).

### Other conventions

- Add a top-of-function comment in `~/.config/zsh/functions/**` using `# <name>: <purpose>` (and `# alias: ...` when needed).
- For behavioural changes to shell functions/scripts, prefer adding or updating Bats tests in `~/.config/zsh/tests/`; run `mise run zsh-tests`.
- Test shell scripts by public behaviour: args, exit status, stdout/stderr, and filesystem effects; use `test_helper.bash` for isolated `HOME`/`PATH`.
- oh-my-zsh git plugin defines ~200 `g*` aliases (e.g. `gcl`, `gco`, `gca`). Run `alias <name>` before creating new `g*` functions/aliases to avoid conflicts.

## Scripts

- [install.sh](./install.sh) - Bootstrap script for new machines

## Nix Targets

```text
darwinConfigurations."Connors-Mac-mini"     # macOS Mac mini via nix-darwin + home-manager
darwinConfigurations."Connors-MacBook-Air"  # macOS MacBook Air via nix-darwin + home-manager
homeConfigurations."connor@penguin"         # Chromebook Linux
homeConfigurations."connor@dev"          # Remote aarch64 Linux
homeConfigurations."connor@rpi5"         # Raspberry Pi 5 (aarch64, server packages, user env only)
homeConfigurations."codespace"           # GitHub Codespaces (minimal)
# RPi5 NixOS system config: github.com/connorads/rpi5
```

### Hybrid NixOS (rpi5)

The rpi5 uses a hybrid setup - two repos, two rebuilds:

- **System** (`nrs`): NixOS config from `~/git/rpi5` (set via `NIXOS_FLAKE` in `.zshrc.local`)
- **User env** (`hms`): shell, tools, git, tmux etc. from dotfiles (`~/.config/nix`)

The `up` function runs both on NixOS. An agent on rpi5 can modify the system config (rpi5 repo) without touching dotfiles.

## Common Commands

```bash
drs                    # darwin-rebuild switch (macOS)
hms                    # home-manager switch (Linux)
nrs                    # nixos-rebuild switch (reads $NIXOS_FLAKE, default: ~/.config/nix)
nrsr                   # nixos-rebuild switch --rollback
up                     # update everything: bump mise.lock + flake.lock, brew/apt, rebuild (NixOS: nrs + hms)
up -s / up --frozen    # frozen rebuild: converge to committed locks (no bumps, no brew/apt, no flake), then rebuild
up --os                # ...plus install no-restart macOS updates (OS updates reported only, never rebooted)
macup                  # install macOS updates by hand (macOS); offers OS reboot path near the machine
macup-check            # report pending macOS updates (cached daily scan; --scan to force)
nfu                    # nix flake update
dotfiles add .file     # Track new file (after un-ignoring in ~/.gitignore)
dotfiles status        # See changes
dhk check              # Run hk checks in dotfiles repo
dhk fix                # Run hk fixes in dotfiles repo
claude-watch [on|off|status]  # arm/disarm Claude auto-continue on a pane (tmux: prefix + T Tools)
shotpath [host]        # save clipboard image locally or upload to host, then copy resulting path to clipboard
ts                     # Tailscale wrapper (defined in .zshrc)
svc ls                 # List agent services with status
svc up <name> [port]   # Start service + expose via Tailscale
svc down <name>        # Stop service + teardown Tailscale route
svc restart <name>     # Restart a service
svc ui                 # fzf service picker (default in TTY)
wt-add <branch>        # Create worktree under ~/.trees, run rs, print path (agent-callable)
wta <branch>           # wt-add + cd into it (human workflow)
wt-status [path]       # Report worktree status; use --all / --json for agent flows
wt-publish             # Push current worktree branch and optionally open a PR
wt-finish --mode local # Merge feature→base, remove worktree, delete branch
wt-finish --mode pr    # Push + open PR via wt-publish (worktree remains)
wt-remove [path]       # Non-interactive managed worktree removal primitive
wti                    # Alias for `wt-status --all`
wtu                    # Human TUI for opening/finishing/publishing/removing worktrees
wts                    # fzf switch to a worktree (works outside git repos)
wt-prune               # Prune stale git worktree metadata after crashes/manual deletes
wt-repair [path...]    # Repair moved worktree metadata
ghcl [owner]           # fzf clone from GitHub (SSH)
ghfzf [pr|issue|run]   # fzf triage for GitHub PRs, issues, and Actions runs
gh-gate init <host>    # Deploy read-only PAT to a managed remote
gh-gate grant <host>   # Push 1-hour write token to a managed remote
gh-gate revoke <host>  # Revoke write token on a managed remote
gh-gate status [host]  # Check token state on a managed remote
gh-gate ui             # Pick SSH host and grant/revoke write access in fzf
sbx new [--net] [name] # Create+attach a VM-isolated box for UNTRUSTED software (offline by default)
sbx shell [name]       # Self-heal (colima+box up) then attach the box's tmux session
sbx net on|off [name]  # Toggle network for a running box
sbx cp <path> [name]   # Copy a host path into the box's /work
sbx list               # List sbx boxes; sbx stop/rm [name] to stop / nuke (box + volume)
lazydocker             # TUI to browse/exec/log/prune containers (nix)
```

### GitHub CLI auth

Desktop/granting hosts use normal `gh auth` keyring auth. `gh-gate` controls `gh`
only where `~/.config/gh-gate/readonly-token` or `active-token` exists; config
alone does not mean read-only.

## Supply Chain & Update Strategy

### Dependency ownership: Nix, mise, Homebrew

Nix owns the machine/profile layer: base shell tools, services, fonts, native
libraries, patched builds, tools needed before mise works, stable CLIs, and GUI
apps where the nixpkgs package is healthy.

Prefer Nix for GUI apps when they are open-source, cross-platform, useful on a
future Linux desktop, or otherwise behave well from nixpkgs. macOS-only GUI apps
can still belong in Nix when declarative ownership and rollback matter.

Homebrew is the macOS app compatibility lane: use it for casks, MAS apps,
proprietary/vendor bundles, self-updating apps, browsers/editors/AI apps with
fast vendor cadence, drivers/extensions, or anything whose signing, permissions,
updates, or app-bundle integration are better via Homebrew.

mise owns the developer-tool layer: language runtimes, package managers,
project-specific tools, npm/pipx/aqua/github/cargo CLIs, fast-moving vendor CLIs
like Claude/Codex, and tools needing direct upstream updates or postinstall
patching.

Rule of thumb: host-global and well-packaged -> Nix; project/version-selected ->
mise; macOS vendor bundle -> Homebrew.

Mise tools use a **4-day quarantine** (`minimum_release_age = "4d"`, formerly `install_before`) - only versions released 4+ days ago are installed. This gives the community time to catch compromised releases. GitHub attestation and SLSA provenance verification are also enabled; `locked_verify_provenance = true` re-verifies provenance at install time even when the lockfile already has a checksum (otherwise skipped on lockfile hits).

**Lockfile** (`lockfile = true`, `lockfile_platforms = ["macos-arm64", "linux-arm64", "linux-x64"]`): the committed `~/.config/mise/mise.lock` pins exact versions **and** checksums per platform - the mise analogue of `flake.lock`. The quarantine gates *resolution time* but pins nothing; the lockfile makes every machine install the identical vetted artifact rather than independently re-resolving ranges. The current platform is always locked regardless; the three listed cover the Macs (`macos-arm64`), dev/rpi5 (`linux-arm64`), and penguin/codespaces (`linux-x64`). Complementary, not a replacement: keep `minimum_release_age` / excludes / attestation / slsa.

**Version ranges, not "latest"**: tools are pinned to major or major.minor ranges (e.g., `deno = "2"`, `pkl = "0.31"`). `mise upgrade` pulls patches within the range; `--bump` crosses boundaries. Claude, Codex and Amp are exempted from quarantine via the `minimum_release_age_excludes` mise setting.

**How `up` works**: by default it *bumps* both lockfiles and commits each change (symmetric with the nix flake model) - `mise upgrade` within ranges (4-day quarantine, selected tools exempt), which auto-locks **every** `lockfile_platforms` entry for each changed tool plus current-platform provenance (so no separate `mise lock` refresh is needed), then `dotfiles commit` the lock if it changed; updates brew/apt; `nfu` + commits `flake.lock`; rebuilds. **`--frozen` / `-s` / `--skip-flake`** is the *frozen* path: bump nothing - converge tools to the committed `mise.lock` via `mise install`, skip brew/apt, skip the flake bump/commit - then rebuild. Use it to reproduce a known-good toolchain (e.g. on a fresh Linux box).

```bash
up                                          # bump mise.lock + flake.lock + brew/apt, commit locks, rebuild
up -s / up --frozen                         # frozen: install committed locks only, no bumps/brew/apt/flake
mise upgrade --bump [tool]                  # cross version boundaries (still 4-day quarantine)
mise upgrade --bump --before 0d [tool]      # skip quarantine for urgent updates
mise outdated                               # available updates within ranges
mise outdated --bump                        # available updates beyond ranges
mise lock -g                                # refresh global lockfile checksums for all platforms
```

**pnpm** (v11): global 4-day quarantine (`minimumReleaseAge: 5760`) + trust policy (`trustPolicy: no-downgrade`) + `ignoreScripts: true` in `~/.config/pnpm/config.yaml` (YAML, camelCase). Applies to all projects. `trustPolicy` blocks installs where a package's trust level has decreased (e.g., Trusted Publisher → unsigned = likely compromise); `trustPolicyIgnoreAfter: 525600` (minutes = 1 year) skips that check for versions published over a year ago - aged backports without provenance (semver@6.3.1, chokidar@4.0.3) are the check's main false-positive class, while a real takeover is a live incident in its first days. Fresh publishes stay fully gated. **v11 reads pnpm settings only from YAML** (`pnpm-workspace.yaml` / global `config.yaml`), never `.npmrc`/`rc` - the old `~/.config/pnpm/rc` is an inert v10 fallback. **macOS gotcha**: pnpm reads its global config from the native dir `~/Library/Preferences/pnpm/`, not `~/.config/pnpm/`, so the dotfile is symlinked there via nix (`home.file."Library/Preferences/pnpm/config.yaml"` in [darwin-shared.nix](./.config/nix/modules/darwin-shared.nix), `mkOutOfStoreSymlink` → the tracked `~/.config/pnpm/config.yaml`). Linux reads `~/.config/pnpm/config.yaml` natively. `blockExoticSubdeps: true` is set explicitly (it's the v11 default, but pinning it keeps the posture auditable in one place and drift-proof).

**npm**: global 4-day quarantine (`min-release-age=4`) in `~/.npmrc`. Note: npm uses `min-release-age` in **days**, pnpm uses `minimumReleaseAge` in **minutes** (5760 = 4 days). `allow-git=none` blocks Git dependencies, which can execute code even when lifecycle scripts are disabled. Project `.npmrc` files should set both age-gate keys if either tool might run. npm has no `trust-policy` equivalent.

**uv**: global 4-day quarantine (`exclude-newer = "4 days"`) in `~/.config/uv/uv.toml`. Applies during resolution (`uv lock`/`uv lock --upgrade`), not during `uv sync --frozen`.

**pip**: global 4-day quarantine (`uploaded-prior-to = P4D`) in `~/.config/pip/pip.conf`. Applies to `pip install`, `pip download`, and `pip wheel` when installing from indexes that expose upload-time metadata. `uv` remains preferred for Python projects because lockfile resolution is easier to audit.

**aube** (primary npm backend for mise): config at `~/.config/aube/config.toml`. Set via mise: `npm.package_manager = "aube"`. Layered defenses beyond a simple age gate:

- `minimumReleaseAge = 5760` (minutes - aube uses minutes, bun uses seconds, pnpm uses minutes, npm uses days)
- `minimumReleaseAgeStrict = true` - fail closed when no version satisfies the age gate. aube's default is advisory (silently falls back to the next-oldest satisfying version), unlike pnpm where strict is the default
- `minimumReleaseAgeExclude = ["@ampcode/*"]` - Amp publishes several times a day; keep the age gate for everything else
- `advisoryBloomCheck = "on"` - ~380KB bloom-filter prefilter for OSV `MAL-*` advisories on lockfile installs (~0.1% FPR, ~1 round-trip per typical install)
- `trustPolicy = "no-downgrade"` (default) - fails install if a package's trust evidence weakens (e.g. previously had SLSA provenance, now doesn't). Real catch: `@mariozechner/clipboard-darwin-arm64@0.3.6` lost provenance after a CI refactor at 0.3.3 - root pkg kept it but platform sibling packages didn't. Same publisher, same npm signing key - added to `trustPolicyExclude` with reasoning in the config comment
- `lowDownloadThreshold = 1000` (default) - refuses packages with <1000 weekly downloads as typosquat defense. Niche-but-trusted tools listed in `allowedUnpopularPackages`
- `allowBuilds = {}` (default empty) - lifecycle scripts blocked unless explicitly allowed via `aube approve-builds <pkg>` or `allowBuilds.pkg = true`

Settings routing: aube reads both `~/.npmrc` (npm-shared keys) and `~/.config/aube/config.toml` (aube-only keys). Keep aube-specific keys in the latter to avoid npm warnings ("Unknown user config 'minimum-release-age'") when mise calls `npm view` for metadata. CLI: `aube config set <key> <value>` routes correctly.

Disk reclaim: `cleanup`'s `aube` target flushes only the regenerable caches `~/.cache/aube/{virtual-store,packuments-full-v1}` (plus `aube cache prune --age-days 0`). It never touches the durable CAS at `~/.local/share/aube/store`, nor `~/.cache/aube/primer` / `adaptive-state.json`.

**bun**: global 4-day quarantine (`minimumReleaseAge = 345600`, seconds) in `~/.bunfig.toml` for direct `bun` use (mise now uses aube as the npm backend). **Must be `$HOME/.bunfig.toml`** - bun 1.3.14 silently ignores `$XDG_CONFIG_HOME/.bunfig.toml` ([oven-sh/bun#26408](https://github.com/oven-sh/bun/issues/26408)). Bun blocks dependency postinstall scripts by default; allow with `bun pm trust`. No `trust-policy` equivalent exists. **Caveat**: project-local `bunfig.toml` shallow-merges and *replaces* the whole `[install]` table from global. For urgent one-offs, use `bun install --minimum-release-age=0`; there is no known env override like npm/pnpm/uv/pip expose.

**Deno**: Deno 2.8+ reads `min-release-age` from `.npmrc` for npm dependencies. `deno install --minimum-dependency-age=0` disables it for an explicit one-off. Lifecycle scripts still require explicit `--allow-scripts`.

**Yarn**: modern Yarn reads `npmMinimalAgeGate: 4d` from `~/.yarnrc.yml`. Yarn 1 ignores this setting, and Corepack can still expose Yarn 1 for legacy projects, so prefer pnpm unless the project pins Yarn 4+.

**Install scripts disabled (npm/pnpm)**: `ignore-scripts=true` in `~/.npmrc` and `ignoreScripts: true` in `~/.config/pnpm/config.yaml`. Most recent npm RCE campaigns (Shai-Hulud, tinycolor, ngx-bootstrap) use `postinstall` as the execution primitive - disabling scripts neutralises that vector regardless of whether the malicious version slipped through quarantine.

pnpm 11 blocks build scripts by default (`allowBuilds`); the `ignoreScripts` setting is belt-and-braces. npm has no equivalent default, so the rc setting is the meaningful change there.

Native modules and codegen need scripts to build. When a project errors out:

1. **Ask the user before allow-listing.** Security decision is theirs, not the agent's.
2. With approval, allow-list specifically:
   - **pnpm** (v11): `pnpm approve-builds` (interactive) or add to `allowBuilds` (in `pnpm-workspace.yaml` / `package.json#pnpm`).
   - **npm**: project-level `.npmrc` with `ignore-scripts=false` (no per-package primitive exists).

**Agents: do not disable this globally.** Ask first, then allow-list narrowly. The friction is the security control.

**Detective layer (osv-scanner)**: every control above is *preventive* and *time-based* - they slow adoption so the community can flag a bad release, but nothing detects malware that already slipped through (the 2026 worm wave shipped packages with *valid* SLSA provenance). `osv-scanner` (mise: `aqua:google/osv-scanner`) closes that gap: `mise run supply-audit` scans the current project's lockfiles (npm, Cargo, uv, …) against the OSV `MAL-*`/vuln database. Run it in a project dir; wire it into CI for repos that matter.

**Cargo/Rust**: the one ecosystem without a stable proactive age-gate, and `build.rs` runs arbitrary code at build with no global off-switch (unlike npm's `ignore-scripts`). Native `-Zmin-publish-age` / `registry.global-min-publish-age` is nightly-only as of Cargo 1.96; revisit once [cargo#17009](https://github.com/rust-lang/cargo/issues/17009) stabilises. For now the cover is reactive: `mise run supply-audit` (osv-scanner) flags known-bad `Cargo.lock` entries, with `cargo audit` / `cargo deny` available on demand (no fast prebuilt in the mise registry, so not pinned).

**Ruby / Bundler**: system Bundler 1.17.2 has no cooldown support. If Ruby work becomes active, install modern Ruby/Bundler and set `bundle config set --global cooldown 4`.

**Composer**: no package-age quarantine is configured; keep `secure-http=true` and Composer audit enabled. Prefer lockfile review plus `mise run supply-audit` where supported.

**mise lockfile** (enabled): `~/.config/mise/mise.lock` pins exact versions + checksums for `macos-arm64`, `linux-arm64`, `linux-x64` (plus the current platform, always). The historical multi-platform blocker is gone - mise `v2025.11.11` added cross-platform lockfiles (other-platform checksums computed from registry metadata, no download) and `v2026.4.8` added `lockfile_platforms`. Caveat: those non-current-platform checksums are *recorded from metadata, not verified by download* here - but install-time `github_attestations` + `slsa` still fire on the machine that actually installs. `claude`/`codex` are `latest`, so their lock entries churn every `up` (no per-tool lock-exclude exists; accepted). `locked` is deliberately **off**: turning it on would fail closed when adding a new tool that isn't in the lockfile yet. Revisit `locked = true` once the toolset is stable.

**Nix**: flake.lock is the checkpoint. `nfu` updates it; `up` commits it. nixpkgs-unstable is correct for macOS (NixOS integration tests are irrelevant for nix-darwin).

## Git Hooks (hk)

Dotfiles commit hooks are tracked in `~/.hk-hooks/` and configured via:

```bash
dotfiles config core.hooksPath .hk-hooks
```

The pre-commit hook runs `hk run pre-commit` using `hk.pkl` at `~/hk.pkl`.

## Agent Skills

Before adding, removing, vendoring, or promoting skills, read
[`~/.config/skills/AGENTS.md`](./.config/skills/AGENTS.md).

Skills load three ways, in preference order. **Canonical home is the catalogue at
`~/.config/skills/{public,personal,vendor}`** - *not* `~/.agents/skills/`, which is the
deliberately small global autoload dir.

1. **`skl` - on-demand, the default (~95% of use).** Pick a catalogue skill → its pointer
   is injected into the agent's tmux pane → the agent reads `SKILL.md`. Zero session cost.
   Authored skills: just drop a dir in `~/.config/skills/{public,personal}`. Third-party:
   `cd ~/.config/skills/vendor && skills add <owner/repo> --skill <name>` (project scope).
2. **Per-project autoload.** `skills add <owner/repo> --skill <name>` (no `-g`) from inside a
   repo → auto-fires for *that repo* only.
3. **Global autoload - rare, used sparingly.** The filesystem at `~/.agents/skills/`
   is the source of truth for the current global set. Vendored globals use `skills add -g`
   and authored globals use symlink + `skillsync`. `skillsync` is deprecated for catalogue
   sync, but remains the supported path for authored global autoload symlinks.

Bookmarked skills live in `~/.agents/README.md` (references only, not installed).

**Curation intent, the rubric, tiers, and lockfile/skillsync rationale live in
[`~/.config/skills/AGENTS.md`](./.config/skills/AGENTS.md).**

## Tailscale

**Always use `ts` wrapper, never raw `tailscale`** - it handles socket paths across platforms:

```bash
ts status                    # List devices
ts ssh connor@rpi5 'cmd'     # SSH via Tailscale
tsp ls                       # Show active serve/funnel status (+ stale targets)
tsp up [port]                # Serve port on Tailnet
tsp down [https-port]        # Tear down a served port
tsp prune --dry-run          # Preview stale served routes
```

### Local dev servers

When writing or updating scripts that start local dev servers, bind them explicitly to loopback instead of relying on tool defaults.

- Prefer `127.0.0.1` / `localhost`, not `0.0.0.0`
- Many tools default to all interfaces (`0.0.0.0`), which can make the dev server itself bind the Tailscale interface and appear to collide with a port already served via Tailscale
- Tailscale exposure is still fine, and usually desired here. Bind the app to loopback first, then expose that local port via `tsp` / `svc`
- This keeps one owner per socket: the app owns `127.0.0.1:PORT`, Tailscale Serve owns the Tailnet-facing listener for that port

Examples:

```bash
next dev -H 127.0.0.1
storybook dev --host 127.0.0.1
http-server -a 127.0.0.1
```

### Serve port registry

Each service uses a dedicated external HTTPS port so multiple services can coexist:

| Service   | `svc` name  | Local port | External HTTPS |
| --------- | ----------- | ---------- | -------------- |
| remobi    | `remobi`    | 7681       | **443** (apex) |
| toad      | `toad`      | 8000       | 8000           |
| gigacode  | `gigacode`  | 2468       | 2468           |
| companion | `companion` | 3456       | 3456           |

Pattern: `ts serve --bg --https=$port $port` - remobi is the exception, omitting `--https=` to claim the apex `:443`.

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
