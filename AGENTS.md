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

## Source vs config

One question decides where a thing lives:

> Does a consumer I don't control read that path?
>
> - **Yes** → `.config/` (or the dot-dir the tool names). The path is the interface.
> - **No**, and it has its own manifest or test suite → `~/src/<name>/`.
>
> Where a tool has both, split them: source in `src/`, config and state in `.config/`.

Sort by who reads the path, not by what the file holds. `init.lua`, `hk.pkl` and `opencode.json` are all code and all stay - nvim, hk and opencode go looking for them there. Rationale and what lost: [docs/adr/0006](./docs/adr/0006-source-in-src-config-in-config.md).

[`~/src/pin-audit`](./src/pin-audit/) is the worked layout: TS implementation under `src/`, a thin dual-mode zsh wrapper in `.config/zsh/functions/`, a `zfn-link` symlink on `PATH`, and its CLI contract in `.config/zsh/tests/pin-audit.bats`.

Hard-coupled, staying put:

| Path | Why it cannot move |
| --- | --- |
| `.pi/agent/extensions` | pi composes the dir as `join(<agent dir>, "extensions")`. The `extensions` settings key is an enable/disable pattern list, not a search path; only `PI_CODING_AGENT_DIR` relocates it, and that drags auth + sessions too |
| `.config/nix/{voxtap,biokc,imagepaste}` | `${../voxtap/main.swift}` is a flake-root-relative path literal; nix copies only the flake dir to the store |
| `.hk-hooks` | `core.hooksPath` is set to `.hk-hooks` |
| `.claude/hooks` | Six scripts named by absolute path in `.claude/settings.json` |
| `.config/opencode/{plugin,plugins-v1,plugins-v2,plugin-disabled}` | `opencode.json`'s `plugin` array names each file by `file://` absolute path, so a moved file stops loading with no error. `.config/opencode/tsconfig.json` follows the code rather than the reverse: its `include` covers all four dirs |

Moving code between these trees is only safe once `mise run gate-coverage` passes. hk steps key on hard-coded path prefixes and fail **open**: a glob matching nothing exits 0, so a missed gate stops enforcing silently rather than failing the commit. A new `src/` project needs the `ts-typecheck-*` step, the `ts-tests-scoped` glob *and* `ts-tests.sh`'s `ROOTS` (Python: `py-typecheck-*`, the `py-tests-scoped` glob *and* `py-tests.sh`'s `ROOTS`), the `bats-scoped` glob *and* a `bats-tests.sh` case arm if it has a bats suite, `mise` checks, and a `.gitignore` un-ignore block.

## Git Hygiene

- Ignore unrelated git changes; do not reset/revert/discard them.
- Treat Codex `[projects.*]` trust entries, hook trust state, marketplace timestamps, app-injected MCP/browser wiring, desktop UI preferences, and model picker keys (`model`, `model_reasoning_effort`, `plan_mode_reasoning_effort`) in [`.codex/config.toml`](./.codex/config.toml) as machine-local state; never commit them. A `codex-config` clean filter strips or normalises them on commit.
- Treat Pi model picker keys (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`) in [`.pi/agent/settings.json`](./.pi/agent/settings.json) as machine-local state; never commit them. A `pi-agent-settings` clean filter normalises them and restores the final newline on commit.
- Treat the `model` key in [`.claude/settings.json`](./.claude/settings.json) as machine-local state - Claude Code's `/model` picker writes it back with no opt-out (since v2.1.153; `s` in the picker is session-only). A `claude-settings` clean filter strips it on commit, and sorts keys (`jq -S`) so the reordering Claude Code does on every rewrite stays out of git; permission arrays keep their authored order.
- Use `dotfiles` commands for dotfiles git operations so config renormalisation (Codex, Claude, and Pi settings clean filters) runs before status/diff/stash.
- Vendored `src/` subprojects (`handoff`, `dotfiles-docs`, `pin-audit`, `skl`, `annotate`, `raycast/shotpath`, `raycast/skl`) are tracked in the dotfiles work-tree, not standalone repos. Never `git init` inside one - it creates a nested repo and double-tracks every file. Commit their changes with `dotfiles`.

## Key Documentation

- [~/README.md](./README.md) - how the dotfiles system works (git-dir + work-tree, nix-darwin, home-manager)
- [docs/adr/](./docs/adr/) - repo-level ADRs; [README](./docs/adr/README.md) states what is local to these dotfiles, the `adr` skill (`skl adr`) owns the format and mechanics. Subprojects keep their own, e.g. [`src/skl/docs/adr/`](./src/skl/docs/adr/)
- [.config/mise/AGENTS.md](./.config/mise/AGENTS.md) - mise quarantine, lockfile and ranges, aube, how `up` works
- [docs/supply-chain.md](./docs/supply-chain.md) - per-package-manager quarantine, install-script block, osv-scanner, Homebrew cleanup
- [.hk-hooks/AGENTS.md](./.hk-hooks/AGENTS.md) - every pre-commit gate and why it exists
- [connorads/rpi5](https://github.com/connorads/rpi5) - RPi5 NixOS configuration (standalone repo)

## Configuration Files

Detail lives in each file's header comment or the linked subsystem doc.

| File | Purpose |
| --- | --- |
| [flake.nix](./.config/nix/flake.nix) | Main Nix config: macOS (nix-darwin), Linux (home-manager) |
| [modules/biokc.nix](./.config/nix/modules/biokc.nix) | Builds `biokc`, the Touch ID keychain helper gh-gate uses; desktop-only |
| [modules/imagepaste.nix](./.config/nix/modules/imagepaste.nix) | Builds `imagepaste`, which keeps clipboard GIF bytes for `shotpath` |
| [packages/terminal-control.nix](./.config/nix/packages/terminal-control.nix) | Builds `termctrl` (drive and render terminal apps in a real PTY); pairs with the `terminal-control` skill |
| [packages/footswitch.nix](./.config/nix/packages/footswitch.nix) | Builds `footswitch` for the foot pedal, driven by `pedal-flash`; desktop macOS only |
| [config.toml](./.config/mise/config.toml) | mise tools; maintenance: [.config/mise/AGENTS.md](./.config/mise/AGENTS.md) |
| [.config/srt/base.json](./.config/srt/base.json) | `agent-sandbox` (`asb`) OS sandbox policies; docs: [.config/srt/AGENTS.md](./.config/srt/AGENTS.md) |
| [.config/sbx/Dockerfile](./.config/sbx/Dockerfile) | Image for `sbx`: VM-isolated box for UNTRUSTED software. No host mounts, cap-drop ALL, offline by default |
| [.vale.ini](./.vale.ini) | Vale config for the house prose rules; applies to markdown and code comments |
| [.config/vale/styles/Connorads/](./.config/vale/styles/Connorads/) | The house style rules; tests: [vale-style.bats](./.config/zsh/tests/vale-style.bats) |
| [.oxlintrc.json](./.oxlintrc.json) | The tree's only oxlint config, type-aware rules on |
| [.config/opencode/package.json](./.config/opencode/package.json) | opencode plugin deps; opencode runs `bun install` on it, so the path is the interface |
| [.npmrc](./.npmrc), [.config/pnpm/config.yaml](./.config/pnpm/config.yaml), [.bunfig.toml](./.bunfig.toml), [.config/pip/pip.conf](./.config/pip/pip.conf), [.yarnrc.yml](./.yarnrc.yml) | Per-manager quarantine and install-script block; see [docs/supply-chain.md](./docs/supply-chain.md) |
| [.config/aube/config.toml](./.config/aube/config.toml) | aube, mise's npm backend: quarantine, trust policy, typosquat gates |
| [.zshrc](./.zshrc) | Shell config with aliases and autoloaded helpers |
| [.zshrc.local.example](./.zshrc.local.example) | Template for machine-local secrets in `~/.zshrc.local` |
| [kitty.conf](./.config/kitty/kitty.conf) | Terminal emulator config |
| [tmux.conf](./.config/tmux/tmux.conf) | tmux config; maintenance: [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [config.kdl](./.config/zellij/config.kdl) | zellij config; maintenance: [.config/zellij/AGENTS.md](./.config/zellij/AGENTS.md) |
| [help.md](./.config/tmux/help.md) | tmux keybindings cheatsheet (`Ctrl+b ?`) |
| [claude-watcher/README.md](./.config/claude-watcher/README.md) | Per-pane Claude auto-continue watcher |
| [.claude/subagent-statusline.sh](./.claude/subagent-statusline.sh) | Model and context gauge on each row of Claude Code's agent panel; tests: [subagent-statusline.bats](./.config/zsh/tests/subagent-statusline.bats) |
| [tmux/scripts/mem-lib.sh](./.config/tmux/scripts/mem-lib.sh) | Memory-pressure states (OK/BUSY/CRITICAL) shared by the status gauge, popup and `memwatch` |
| [tmux/scripts/agent-state.sh](./.config/tmux/scripts/agent-state.sh) | Per-pane `@agent_state`. Agents: use `agent wait`/`agent ls`, don't scrape |
| [tmux/strategies/](./.config/tmux/strategies/) | Resurrect restore that resumes each Claude/Codex conversation. Already built - do not re-implement |
| [zsh/functions/macos/memwatch](./.config/zsh/functions/macos/memwatch) | launchd memory watcher; at CRITICAL it hibernates the heaviest idle agent pane. Log `~/.cache/memwatch.log` |
| [init.lua](./.config/nvim/init.lua) | Neovim config |
| [config.json](./.config/fresh/config.json) | Fresh terminal IDE config |
| [.fresh/config.json](./.fresh/config.json) | Fresh project config for this work-tree (shows hidden files) |
| [~/.config/zsh/functions/](./.config/zsh/functions/) | Custom shell functions (autoloaded in zsh, also on PATH) |
| [~/.local/bin/](./.local/bin/) | Symlinks to dual-mode zsh functions; includes `git-hunks` |
| [~/.local/bin/gh](./.local/bin/gh) | `gh` wrapper; keyring auth unless gh-gate token files exist |
| [~/.config/zsh/aliases/](./.config/zsh/aliases/) | Tool-specific aliases (sourced from `.zshrc`) |
| [~/.config/remobi/remobi.config.ts](./.config/remobi/remobi.config.ts) | remobi config ([connorads/remobi](https://github.com/connorads/remobi)) |
| [~/src/raycast/shotpath](./src/raycast/shotpath) | Raycast extension for `shotpath`; outside dot dirs because Raycast rejects hidden source paths |
| [~/src/dotfiles-docs](./src/dotfiles-docs/AGENTS.md) | "How I work" Starlight site; commit with `dotfiles commit -- src/dotfiles-docs` |
| [gh-gate](./.config/zsh/functions/git/gh-gate) | Scoped gh tokens via a GitHub App; `gh-gate --help` for setup |
| [mcpz](./.config/zsh/functions/agents/mcpz) | Render and launch MCP bundles per agent; docs: [.config/mcp/AGENTS.md](./.config/mcp/AGENTS.md) |
| [.config/vox/](./.config/vox/) | `vox` merge filter and vocabulary map; docs: [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [~/src/handoff](./src/handoff/README.md) | `handoff` (Python). Tests: `cd ~/src/handoff && uv run --group dev pytest -c pyproject.toml` |
| [~/src/pin-audit](./src/pin-audit/) | `pin-audit` (bun/TS). Tests: `bun test` there, plus `pin-audit.bats` |
| [~/src/skl](./src/skl/CONTEXT.md) | `skl` (bun/TS); config `.config/skl/config.json`. Tests: `bun test` there, plus `skl-pick.bats` |
| [~/src/annotate](./src/annotate/CONTEXT.md) | `annotate` (bun/TS); log `~/.local/state/agents/annotate.jsonl`. Tests: `bun test` there, plus `annotate.bats`, `annotate-lib.bats` |
| [~/src/raycast/skl](./src/raycast/skl/README.md) | Raycast extension over the `skl` catalogue; couples to the `~/.local/bin/skl` shim |
| `src/oyp/oyp.sh` | `oyp`: open the current PR in the terminal (via `.local/bin/oyp`) |

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

Zsh-only files drop the shebang and instead carry a `# zsh-only: <reason>`
marker directly under the header (see below).

**When to add shebang (dual-mode):** Add when the function does NOT:

- `cd` into a directory (would affect calling script, not caller's shell)
- `export` variables into the caller's environment
- `source` files into the caller's shell
- Use `print -z` (zsh command buffer injection)
- Define completions (`compdef`, `compadd`, `add-zsh-hook`, `_*` prefix)

**Zsh-only functions** (no shebang, autoload only) self-declare with a
`# zsh-only: <reason>` marker in their first lines - reasons follow the list
above (cd / export / source / print -z / completion), plus sourced libs and
launchd-managed daemons. List them with:

```bash
grep -rl '^# zsh-only:' ~/.config/zsh/functions
```

**Enforcement**: the `zsh-fn-header` hk step checks every file under
`.config/zsh/functions/` for the `# <name>: <purpose>` header and requires
shebang XOR `# zsh-only:` marker (script: `~/.hk-hooks/zsh-fn-header-check.sh`,
tests: `~/.config/zsh/tests/zsh-fn-header.bats`).

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
- Split a tab-separated record with `"${(@ps:\t:)rec}"`, never `IFS=$'\t' read`: tab is IFS whitespace, so `read` collapses runs of tabs and every interior empty field shifts the rest left, silently. This tree is full of TSV-record shell code and 11 live sites are already wrong; mechanism, repro and audit in the `mechanical-enforcement` skill (`references/shell-quality.md`, `## zsh`).

## Scripts

- [install.sh](./install.sh) - Bootstrap script for new machines

## Nix Targets

```text
darwinConfigurations."Connors-Mac-mini"     # macOS Mac mini via nix-darwin + home-manager
darwinConfigurations."Connors-MacBook-Air"  # macOS MacBook Air via nix-darwin + home-manager
homeConfigurations."connor@penguin"         # Chromebook Linux
homeConfigurations."connor@dev"          # Remote x86_64 Linux (bare name = live box's arch)
homeConfigurations."connor@dev-aarch64-linux"  # Remote dev box, aarch64 variant
homeConfigurations."connor@dev-x86_64-linux"   # Remote dev box, x86_64 variant
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

Run `<cmd> --help` for flags and subcommands.

```bash
drs | hms | nrs        # rebuild: darwin (macOS) | home-manager (Linux) | nixos; add r (drsr...) to roll back
up                     # update everything: bump + commit mise.lock and flake.lock, brew/apt, rebuild
up -s                  # frozen rebuild from committed locks; no bumps, no commit
nfu                    # nix flake update
lockfile-audit         # OSV sweep of tracked lockfiles; MAL-* blocks, CVEs report
pin-audit              # report pins/excludes to recheck and range pins the newest release outgrew
mise-npm-where [TOOL]  # installed package dir of an npm-backed mise tool (`mise which` for bins)
macup | macup-check    # install | report pending macOS updates
pedal-flash            # flash and verify the foot pedal mapping
dotfiles <git args>    # git for the dotfiles work-tree (add, status, commit...)
dhk check|fix|test     # hk checks, fixes, and the steps' own tests
git hooks status       # which hooks a repo declares vs what actually fires
mise run ts-checks     # typecheck + test all first-party TS
mise run py-checks     # lint + typecheck + test all first-party Python
mise run skill-checks  # colocated skill-script tests, all tiers
mise run zsh-tests     # the whole bats suite
prose [path...]        # lint markdown and code comments against the house rules, in any repo
eraser <cmd>           # Eraser diagrams rendered locally; never call the bare `eraser-diagrams`
ccp [-y] [<name>]      # launch Claude Code on an account (bare = picker); --mcp <bundle> adds MCP
claude-usage --all     # refresh usage for every Claude account
claude-watch           # arm/disarm Claude auto-continue on a pane
mcpz                   # MCP bundles: list, show, render, run per agent
agent <sub>            # live agent panes: ls, state, wait, prompt, name, pick, goto, hibernate, thaw, auto, pin
coord                  # jump to the coordinator agent, launching it if absent
atp                    # teleport a live Claude/Codex session to another host
handoff                # translate a session between Claude Code and Codex
shotpath [host]        # save or upload the clipboard image, copy its path
annotate <sub>         # stash excerpts, then send them to an agent as one prompt
vox                    # record mic + system audio; `vox stop` transcribes locally
ts | tsp               # Tailscale wrapper | serve/funnel ports (see Tailscale)
svc <sub>              # agent services: ls, up, down, restart, ui
wt-add <branch>        # new worktree under ~/.trees, set up, print path (agent-callable)
wta <branch>           # wt-add + cd (human)
wt-status | wti        # worktree status; wti = --all
wt-publish             # push the worktree branch, optionally open a PR
wt-finish --mode local|pr  # merge locally and remove, or push and open a PR
wt-clean | wtc         # reap worktrees whose PR merged, and their branches
wt-remove [path]       # remove one managed worktree
wtu | wts              # worktree TUI | fzf switch
wt-prune | wt-repair   # fix stale or moved worktree metadata
ghcl [owner]           # fzf clone from GitHub
ghcl-org <org>         # bulk-clone or re-sync an org into cwd
ghfzf [pr|issue|run]   # fzf triage for PRs, issues and Actions runs
gh-gate <sub> <host>   # scoped gh tokens on a remote: init, grant, revoke, status, ui
sbx <sub>              # VM-isolated box for UNTRUSTED software: new, shell, net, cp, list, stop, rm
zellij | lazydocker    # alternative multiplexer | container TUI
```

### Xcode

Nix does not install Xcode. MAS serves latest only, so a `masApps` entry is a
standing upgrade across majors with no pinning and no way to hold one back.
When a project needs Xcode, add `xcodes` to mise (`aqua:XcodesOrg/xcodes`,
macOS-only via `os = ["macos"]` - its release assets are all Homebrew bottles)
and let it manage versions side by side; that route authenticates against the
developer portal rather than the App Store.

`brew bundle cleanup` only uninstalls formulae, casks and taps, so `cleanup =
"zap"` never removes a MAS app. An Xcode installed while it was a `masApps`
entry stays on disk until deleted by hand.

The Command Line Tools stay installed as the baseline: `xcode-select -p` points
at `/Library/Developer/CommandLineTools` until something moves it. Three
derivations compile against whatever `xcrun --show-sdk-path` returns -
[biokc.nix](./.config/nix/modules/biokc.nix),
[imagepaste.nix](./.config/nix/modules/imagepaste.nix),
[voxtap.nix](./.config/nix/modules/voxtap.nix), plus the shim in
[terminal-control.nix](./.config/nix/packages/terminal-control.nix) - so
selecting an Xcode changes their SDK on the next `drs`. Each falls back to the
CLT SDK path when `xcrun` fails, which is why the CLT must not be removed.

First run of a fresh Xcode needs `sudo xcodebuild -license accept` and
`xcodebuild -runFirstLaunch`. Simulator runtimes are a separate ~7-10 GB each
(`xcodebuild -downloadPlatform iOS`); install them only when a project needs one.

### ccp account config inheritance

`CLAUDE_CONFIG_DIR` fully relocates the user scope, so a `ccp` account would
otherwise read none of the shared `~/.claude` config. Each launch (and resurrect
restore) runs [`claude-profile-materialise`](./.config/zsh/functions/claude-profile-materialise),
which merges the shared `settings.json` (statusline, hooks, env, permissions)
over the profile's own - base winning, `model` stripped - and symlinks
`CLAUDE.md` at the shared memory. So isolated accounts inherit the shared user
config while keeping their own auth/session and per-account `model`/`theme`.
`settings.local.json` (the local permissions/sandbox scope) stays per-account.

### GitHub CLI auth

Desktop/granting hosts use normal `gh auth` keyring auth. `gh-gate` controls `gh`
only where `~/.config/gh-gate/readonly-token` or `active-token` exists; config
alone does not mean read-only.

### Agent command history (atuin)

Shell commands run by coding agents are recorded in atuin with `--author <agent>`:
Claude Code and Codex via hook entries (`atuin hook claude-code|codex`) in
[.claude/settings.json](./.claude/settings.json) / [.codex/hooks.json](./.codex/hooks.json),
pi via [.pi/agent/extensions/atuin.ts](./.pi/agent/extensions/atuin.ts). All three
configs are dotfiles-tracked, so machines inherit on pull; atuin ≥18.17 (nix-owned)
is required. Interactive Ctrl+R stays user-only (`$all-user` default filter).

```bash
atuin search --author '$all-agent' -- 'wt-'    # what agents actually run
atuin search --author claude-code --format '{intent} | {command}' -- ''  # Bash description lands as intent
```

Caveats:

- `atuin stats` has no author filter and counts agent entries (verified on 18.17) -
  filter usage analyses via `atuin search --author` instead.
- Codex requires one-time per-machine hook trust (`/hooks` in the codex TUI);
  trust state lives in `.codex/config.toml` and is machine-local (clean filter
  strips it). Untrusted hooks are silently skipped - no capture until trusted.
- Codex has no `PostToolUseFailure` event; that entry in `hooks.json` is inert
  there and exists so `atuin hook install codex` stays idempotent.
- `atuin hook install <agent>` rewrites the whole config with its own formatting
  even when every entry already exists - hand-edit tracked files instead.
- The pi extension is version-coupled to the atuin binary: after major atuin
  upgrades, re-run `atuin hook install pi` and diff.

## Supply Chain & Update Strategy

Detail: mise, aube, `up` and the lockfile in [.config/mise/AGENTS.md](./.config/mise/AGENTS.md); per-manager quarantine, install scripts, osv-scanner and Homebrew cleanup in [docs/supply-chain.md](./docs/supply-chain.md).

### Dependency ownership: Nix, mise, Homebrew

- **Nix** owns the machine layer: base shell tools, services, fonts, native libraries, patched builds, tools mise needs, and GUI apps that are healthy in nixpkgs.
- **mise** owns the developer-tool layer: runtimes, package managers, project tools, npm/pipx/aqua/github/cargo CLIs, fast-moving vendor CLIs like Claude and Codex.
- **Homebrew** is the macOS app lane: casks, MAS apps, vendor bundles, self-updating apps, drivers, and anything whose signing or app-bundle integration works better through brew.

Rule of thumb: host-global and well-packaged -> Nix; project/version-selected ->
mise; macOS vendor bundle -> Homebrew.

Claude Code is mise-owned. Do not install it natively or re-enable its self-updater. Why: [docs/adr/0011](./docs/adr/0011-claude-binary-is-not-patched-and-mise-owns-the-install.md).

### Quarantine

Every package manager installs only versions released 4+ days ago: mise, aube, pnpm, npm, bun, uv, pip and Yarn. Each spells it in its own unit: days for npm, 5760 minutes for pnpm and aube, 345600 seconds for bun, `P4D` for pip. The `quarantine-drift` gate blocks a commit when the nine configs disagree.

For an urgent mise tool update, bypass it once with `mise upgrade --bump --before 0d <tool>`.

**Nix**: flake.lock is the checkpoint. `nfu` updates it; `up` commits it. nixpkgs-unstable is correct for macOS (NixOS integration tests are irrelevant for nix-darwin).

### Install scripts

Install scripts are blocked for npm, pnpm, bun, aube and mise's npm tools. When a native module or codegen step fails for lack of one:

1. Ask the user before allow-listing. The security decision is theirs.
2. With approval, allow one package. pnpm: `allowBuilds` in `pnpm-workspace.yaml`. mise npm tool: the per-tool `allow_builds` list in `.config/mise/config.toml`. npm: a project `.npmrc` with `ignore-scripts=false`.
3. Never disable the block globally.

The block also leaves a repo's husky/hk hooks unarmed and skips its own `postinstall`. `rs` and `git hooks status` report both; arming stays a manual step.

## Git Identity Guard

Every repo on this machine runs one global pre-commit hook: the identity guard at
`~/.config/git/hooks/identity-guard`, generated by
[home-shared.nix](./.config/nix/modules/home-shared.nix). It blocks a commit whose
author email is not a `@users.noreply.github.com` address, so a personal address can't
be baked into commit metadata by a stray `git config user.email`.

It is wired as a **config hook** (`hook.identity-guard.command` + `.event`, git >= 2.54),
not a file in `.git/hooks`. Two consequences worth knowing:

- Config hooks run *in addition to* directory hooks, so the guard covers repos that set
  `core.hooksPath` (every `.hk-hooks` repo) - a `.git/hooks` hook does not.
- Nothing is copied into a repo at clone time, so there is one copy to improve and no
  repo can hold a stale one. `drs`/`hms` re-point the path every switch.

Per-repo opt-out, for a repo that genuinely needs another identity:

```bash
git config guard.allowNonGithubEmail true
```

Requires git >= 2.54; older git silently ignores the `hook.*` keys, so `git hooks status`
is how you check what actually fires.

### Force-push guard

`push.useForceIfIncludes = true` (same nix module) adds `--force-if-includes` to
every `--force-with-lease`, which is what lazygit's "branch has diverged" prompt
sends. Git then requires the remote tip to appear in the local branch's reflog,
so a lease that matches only because `fetch` just ran no longer lets the push
discard commits never integrated locally. The rejection reads `[rejected] ...
(stale info)`. Integrate first (`git pull --rebase`) and the same push goes
through; fast-forwards, merges and rebased-branch force pushes are unaffected.
Plain `git push --force` or `--no-force-if-includes` is the typed escape hatch.

## Git Hooks (hk)

- `core.hooksPath` is `.hk-hooks`; pre-commit runs `hk run pre-commit -q` from `~/hk.pkl`.
- The `amends`/`import` pin in `hk.pkl` must name the same version as the mise-installed `hk`. A mismatch makes builtin steps fail with `no command for test`.
- `dhk check`, `dhk fix`, `dhk test` (the steps' own `tests {}` blocks).
- Gates fail open: a glob that matches nothing exits 0. After moving code between trees, run `mise run gate-coverage`.
- There is deliberately no pre-push gate. `git push` holds the GitHub connection open while pre-push runs, and GitHub drops it before a whole-suite run ends. Run `mise run zsh-tests` by hand.

Gate-by-gate detail: [.hk-hooks/AGENTS.md](./.hk-hooks/AGENTS.md).

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

`~/.agents/` is the single agents root, for skills and for instructions
(`~/.agents/AGENTS.md`). Codex, opencode, pi and Amp read `~/.agents/skills` natively;
Claude Code does not - its user scope is `~/.claude/skills`, which is the one arm
`skillsync` fans out to. `~/.codex/skills` is read as well, despite being absent from
Codex's published scope list and marked deprecated upstream, so prefer the documented
path. Why this root and not an XDG one:
[docs/adr/0002](./docs/adr/0002-agents-root.md).

Bookmarked skills live in `~/.agents/README.md` (references only, not installed).

**Curation intent, the rubric, tiers, and lockfile/skillsync rationale live in
[`~/.config/skills/AGENTS.md`](./.config/skills/AGENTS.md).**

## Tmux (agent safety)

Never run experimental or mutating `tmux` commands against the live server to
"check behaviour" - no `new-session`, `split-window`, `select-pane -P`,
`set-option`, or `kill-server` on the default socket. The running server holds
real work, and the pane/layout path segfaults easily on some builds, so a stray
probe can drop the server and trigger a resurrect restore cycle. Verify tmux
behaviour from `man tmux`/docs, or on a throwaway socket that can never reach the
real one:

```bash
tmux -L probe -f /dev/null new-session -d 'sleep 1'   # isolated server
tmux -L probe kill-server
```

This bans *probing*, not legitimate scripted use - `agent-state.sh`, resurrect,
and other first-party scripts drive `tmux set-option`/`split-window` by design.
Don't delegate tmux verification to a general-purpose subagent either; the same
rule binds it, and a broad-tools agent is likelier to experiment on the live
server.

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
| remobi    | `remobi`    | 7682       | **443** (apex) |
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
- [~/src/dotfiles-docs](./src/dotfiles-docs/AGENTS.md) - the "How I work" site
  justifies subsystems these dotfiles encode (keybindings, aliases, tool
  choices, security posture). When a change alters something a page covers,
  update that page in the same commit; check the sidebar in
  `src/dotfiles-docs/astro.config.mjs` for what's covered
