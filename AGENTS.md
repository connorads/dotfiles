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

| File                                                                   | Purpose                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [flake.nix](./.config/nix/flake.nix)                                   | Main Nix config: macOS (nix-darwin), Linux (home-manager)                                 |
| [modules/biokc.nix](./.config/nix/modules/biokc.nix)                   | Builds `biokc` (Touch ID keychain helper) from [`main.swift`](./.config/nix/biokc/main.swift) via system swiftc; desktop-only. Used by gh-gate to fingerprint-gate the key |
| [modules/imagepaste.nix](./.config/nix/modules/imagepaste.nix)         | Builds `imagepaste` from [`main.swift`](./.config/nix/imagepaste/main.swift) via system swiftc; preserves clipboard GIF bytes for `shotpath`, then falls back to PNG |
| [packages/terminal-control.nix](./.config/nix/packages/terminal-control.nix) | Nix-built Rust CLI `termctrl` (drive/inspect/test terminal apps in a real PTY, VT100 render to PNG/SVG/text) from a pinned+hashed GitHub source; all hosts. Paired with the vendored `terminal-control` skill |
| [packages/footswitch.nix](./.config/nix/packages/footswitch.nix)         | Nix-built `footswitch` (rgerganov, pinned rev + hash) for flashing the PCsensor USB foot pedal; desktop macOS only. nixpkgs' package is Linux-only and predates the macOS HID-interface fix. Driven by `pedal-flash` |
| [config.toml](./.config/mise/config.toml)                              | mise tools (gh, opencode, etc.)                                                           |
| [.config/srt/base.json](./.config/srt/base.json)                       | `agent-sandbox` (`asb`) srt policies: opt-in OS sandbox for CLI agents. Subsystem docs: [.config/srt/AGENTS.md](./.config/srt/AGENTS.md) |
| [.config/sbx/Dockerfile](./.config/sbx/Dockerfile)                     | Image for `sbx` ([zsh/functions/agents/sbx](./.config/zsh/functions/agents/sbx)): VM-isolated (colima) container for running UNTRUSTED software. Inverse of `agentbox` - no host mounts, cap-drop ALL, offline by default. Capable toolbox baked in (build/net/trace tools); no host dotfiles |
| [.vale.ini](./.vale.ini)                                               | Vale config for the house prose rules. `StylesPath` resolves relative to the file, so `prose` applies it from any cwd; the work-tree root is `$HOME`, so Vale's search-up finds it globally too. Two format sections: markdown, and the extensions Vale extracts code comments from |
| [.config/vale/styles/Connorads/](./.config/vale/styles/Connorads/)     | The house style: `Dashes` (the em/en dash ban), `PlainWord`, `Spellings`. Named `Connorads`, not `House`, so it cannot shadow the client repos' own `House` via the global styles dir. Every rule carries `level: error` - without it the rule is a silent no-op under `MinAlertLevel = error`. Tests: [vale-style.bats](./.config/zsh/tests/vale-style.bats) |
| [.oxlintrc.json](./.oxlintrc.json)                                     | oxlint config; the only one in the tree, so it governs every oxlint run in the work-tree. Turns on the type-aware rules (`options.typeAware`) and exempts `node:test`'s own `test`/`it`/`describe` from `no-floating-promises` |
| [.config/opencode/package.json](./.config/opencode/package.json)       | Authored by us, consumed by opencode (it runs `bun install` on the config dir at startup), so the path is the interface. Pairs with a `tsconfig.json` covering the four plugin dirs; typecheck-only, no `test` script |
| [.npmrc](./.npmrc)                                                     | npm quarantine (`min-release-age`, in days), Git dependency block (`allow-git=none`); also read by Deno npm installs |
| [.config/pnpm/config.yaml](./.config/pnpm/config.yaml)                 | pnpm 12 quarantine + trust-policy + ignore-scripts (YAML). macOS reads it via a nix-managed symlink at `~/Library/Preferences/pnpm/config.yaml` ([darwin-shared.nix](./.config/nix/modules/darwin-shared.nix)) |
| [.bunfig.toml](./.bunfig.toml)                                         | bun quarantine (`minimumReleaseAge`, in seconds) for direct `bun` use. Must live at `$HOME` - XDG path is ignored on bun 1.3.14 (oven-sh/bun#26408) |
| [.config/pip/pip.conf](./.config/pip/pip.conf)                         | pip quarantine (`uploaded-prior-to = P4D`) for direct `pip install` / `download` / `wheel` |
| [.yarnrc.yml](./.yarnrc.yml)                                           | Modern Yarn quarantine (`npmMinimalAgeGate: 4d`). Yarn 1 ignores this; prefer pnpm there |
| [.config/aube/config.toml](./.config/aube/config.toml)                 | aube quarantine + trustPolicy + low-download gate + advisoryBloomCheck. Primary npm backend for mise (`npm.package_manager = "aube"`, the embedded library since mise v2026.7.15; `aube_cli` names the old shell-out path) |
| [.zshrc](./.zshrc)                                                     | Shell config with aliases and autoloaded helpers                                          |
| [.zshrc.local.example](./.zshrc.local.example)                         | Template for machine-local secrets in `~/.zshrc.local`                                    |
| [kitty.conf](./.config/kitty/kitty.conf)                               | Terminal emulator config                                                                  |
| [tmux.conf](./.config/tmux/tmux.conf)                                  | tmux configuration · maintenance: [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md)       |
| [config.kdl](./.config/zellij/config.kdl)                             | zellij configuration (KDL) · maintenance: [.config/zellij/AGENTS.md](./.config/zellij/AGENTS.md) |
| [help.md](./.config/tmux/help.md)                                      | tmux keybindings cheatsheet (`Ctrl+b ?`)                                                  |
| [claude-watcher/README.md](./.config/claude-watcher/README.md)         | Per-pane Claude auto-continue watcher (arm/disarm via `prefix + T` Tools or pane context menu); design + env vars   |
| [.claude/subagent-statusline.sh](./.claude/subagent-statusline.sh)     | Decorates each row of Claude Code's agent panel with that agent's own model and context gauge. Driven by the `subagentStatusLine` setting, which is separate from `statusLine`: that one is session-scoped and reports the main thread only. Receives every visible row as one JSON payload and answers in JSONL, so one `jq` run covers the panel. The panel gives a model id, not a display name, so the label is derived here; colour bands come from [statusline.sh](./.claude/statusline.sh). Any failure exits 0 and every row keeps its default. Tests: [.config/zsh/tests/subagent-statusline.bats](./.config/zsh/tests/subagent-statusline.bats), whose last case guards against the setting vanishing from the binary |
| [tmux/scripts/mem-lib.sh](./.config/tmux/scripts/mem-lib.sh)            | Memory-pressure vocabulary (OK/BUSY/CRITICAL) shared by the status gauge, `prefix + Alt+m` popup, and `memwatch`; state is the fill of the compressor's two ceilings (slots and segments, both kernel panic limits); kernel critical pressure escalates on its own, warn pressure only marks the figure with `▲`, swap is a figure only. Per-arm helpers (`mem_arm_state` / `mem_arm_gap` / `mem_bar_marked`) give every surface the distance to the next line. Subsystem docs in [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [tmux/scripts/agent-state.sh](./.config/tmux/scripts/agent-state.sh)    | Hook-driven agent status: per-pane `@agent_state` (`blocked>done>working>idle`, seen-bit done→idle), window dots, outer-terminal bell on blocked. Agents: use `agent wait`/`agent ls`, don't scrape - see the `coding-agents` skill (`skl`). Subsystem docs in [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [tmux/strategies/](./.config/tmux/strategies/)                          | Resurrect agent-session restore: Claude/Codex panes resume their own conversation via an in-pane launcher keyed on `$TMUX_PANE` (exact, client-independent); OpenCode stays eval-time. Saved-argv flag fidelity throughout. Already built - do not re-implement. Subsystem docs in [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [zsh/functions/macos/memwatch](./.config/zsh/functions/macos/memwatch) | Desktop-only launchd watcher ([darwin-desktop.nix](./.config/nix/modules/darwin-desktop.nix)): 5 s ticks over the compressor ceilings, a banner on a transition into BUSY/CRITICAL naming each arm's distance to its next line (re-logged only once the reading moves), a sleep-overshoot liveness probe (a wake 5 s late reads CRITICAL, cause `stall`), and at CRITICAL the emergency tier: hibernate the heaviest idle/done agent pane under the shared `@agent_auto_hibernate` mode and pins. Log `~/.cache/memwatch.log`; reload `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"` |
| [init.lua](./.config/nvim/init.lua)                                    | Neovim configuration                                                                      |
| [config.json](./.config/fresh/config.json)                             | Fresh terminal IDE configuration; local theme/help live under `~/.config/fresh/`           |
| [.fresh/config.json](./.fresh/config.json)                             | Fresh project config for this dotfiles work-tree (shows hidden files from `~`)             |
| [~/.config/zsh/functions/](./.config/zsh/functions/)                   | Custom shell functions (autoloaded in zsh, also on PATH as executables)                   |
| [~/.local/bin/](./.local/bin/)                                         | Symlinks to dual-mode zsh functions (callable from any shell/agent); includes `git-hunks` |
| [~/.local/bin/gh](./.local/bin/gh)                                     | `gh` wrapper; normal keyring auth unless gh-gate token files exist                       |
| [~/.config/zsh/aliases/](./.config/zsh/aliases/)                       | Tool-specific aliases (sourced from `.zshrc`)                                             |
| [~/.config/remobi/remobi.config.ts](./.config/remobi/remobi.config.ts) | remobi config (package: [connorads/remobi](https://github.com/connorads/remobi))          |
| [~/src/raycast/shotpath](./src/raycast/shotpath)                       | Local Raycast extension wrapping the `shotpath` command; kept outside dot dirs because Raycast rejects hidden development source paths |
| [~/src/dotfiles-docs](./src/dotfiles-docs/AGENTS.md)                   | Astro Starlight site ("How I work") explaining the workflow these dotfiles encode; deploys later to dotfiles.connoradams.co.uk. Scope commits with `dotfiles commit -- src/dotfiles-docs` |
| [gh-gate](./.config/zsh/functions/git/gh-gate)                         | Scoped gh CLI tokens via GitHub App (`gh-gate --help` for full setup); key is Touch ID-gated via biokc on the desktop |
| [mcpz](./.config/zsh/functions/agents/mcpz)                            | Render+launch MCP bundles into each agent's native form (Claude/Codex/OpenCode), resolving secrets fresh at launch. Reads a gitignored registry (the only place client names/URLs live). Subsystem docs + schema: [.config/mcp/AGENTS.md](./.config/mcp/AGENTS.md) |
| [.config/vox/](./.config/vox/)                                         | `vox` merge filter (`merge.py`, stdlib-only) + its pytest and the `wrong<TAB>right` vocabulary map. Subsystem docs: [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| [~/src/handoff](./src/handoff/README.md)                               | `handoff`: translate session history between Claude Code and Codex, both directions (stdlib-only Python; wrapper fn in zsh functions/agents). Gates in its `pyproject.toml`: strict pytest (randomly/timeout/socket, warnings as errors), an import-linter layers contract (`cli -> formats -> ir -> leaves`), deptry; typecheck via `pyrefly.toml` (`strict`). All run at commit time (`py-tests-scoped`, `py-typecheck-handoff`) and from `mise run py-checks`. By hand: `cd ~/src/handoff && uv run --group dev pytest -c pyproject.toml` |
| [~/src/pin-audit](./src/pin-audit/)                                    | `pin-audit`'s implementation: pure core (readPin/judge) + shell adapters (`Bun.TOML.parse`, argv-form `Bun.spawn`), bun with zero runtime deps. The zsh function in `functions/nix` is a wrapper. Tests: `cd ~/src/pin-audit && bun test` (unit) plus `.config/zsh/tests/pin-audit.bats` (CLI contract) |
| [~/src/skl](./src/skl/CONTEXT.md)                                      | `skl`'s implementation: bun/TS, zero runtime deps, own [ADRs](./src/skl/docs/adr/). Config stays at `.config/skl/config.json` (`SKL_CONFIG` overrides); `.local/bin/skl` execs `src/cli.ts`, `bin/pick` is the fzf picker. Tests: `cd ~/src/skl && bun test`, plus `.config/zsh/tests/skl-pick.bats` (picker contract) |
| [~/src/annotate](./src/annotate/CONTEXT.md)                            | `annotate`'s implementation: bun/TS, zero runtime deps, own [ADRs](./src/annotate/docs/adr/). Batch several corrections into one agent prompt - a spool with a slot per excerpt, each keeping its own provenance. Append-only JSONL at `~/.local/state/agents/annotate.jsonl`; wrapper in `functions/agents`, tmux glue in `.config/tmux/scripts/annotate-{stash,pick,lib}.sh`. Tests: `cd ~/src/annotate && bun test`, plus `.config/zsh/tests/annotate.bats` (CLI contract + capture key) and `annotate-lib.bats` (status pill) |
| [~/src/raycast/skl](./src/raycast/skl/README.md)                       | Local Raycast extension over the `skl` catalogue: copy or paste a pointer outside tmux. Couples to the `~/.local/bin/skl` shim, not to skl's source tree |

`oyp` opens the current PR in the terminal through `src/oyp/oyp.sh` and its
`.local/bin/oyp` symlink. The tmux Oyo launcher adds the error pause for floats.

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

```bash
drs                    # darwin-rebuild switch (macOS); extra args forwarded
drsr                   # darwin-rebuild switch --rollback (macOS)
hms                    # home-manager switch (Linux); extra args forwarded
hmsr                   # home-manager switch --rollback (Linux)
nrs                    # nixos-rebuild switch (reads $NIXOS_FLAKE, default: ~/.config/nix)
nrsr                   # nixos-rebuild switch --rollback
up                     # update everything: bump mise.lock + flake.lock, brew/apt, rebuild (NixOS: nrs + hms)
up -s / up --frozen    # frozen rebuild: install clean committed mise.lock, permit a dirty flake.lock retry, then rebuild; no bumps/standalone brew/apt/commit
up --os                # ...plus install no-restart macOS updates (OS updates reported only, never rebooted)
up --no-audit          # skip lockfile and Brew vulnerability scans; keep failure diagnostics
up --verbose           # stream full update output; normal runs keep it in the reported ~/.cache/up log
lockfile-audit         # OSV sweep of tracked repo lockfiles: MAL-* blocks, CVEs report (also: mise run lockfile-audit)
pin-audit              # recheck conditional pins/excludes + flag range pins the newest release outgrew; report-only, FLAG = act by hand (also: mise run pin-audit). Thin zsh wrapper over ~/src/pin-audit (TS/bun); no bun = one SKIP line, never a failure
mise-npm-where [TOOL]  # print the installed package dir for an npm-backed mise tool, probing the three layouts mise's npm backend has shipped. Use `mise which <cmd>` for a bin (mise's own probe order); this is for the package dir. --install-dir/--package override
macup                  # install macOS updates by hand (macOS); offers OS reboot path near the machine
macup-check            # report pending macOS updates (cached daily scan; --scan to force)
pedal-flash            # flash the PCsensor foot pedal (left Esc, centre right Option = MacWhisper hold-to-talk, right Enter) and verify by readback; --read / --dry-run
nfu                    # nix flake update
dotfiles add .file     # Track new file (after un-ignoring in ~/.gitignore)
dotfiles status        # See changes
dhk check              # Run hk checks in dotfiles repo
dhk fix                # Run hk fixes in dotfiles repo
dhk test               # Run the hk steps' own tests (the `tests {}` blocks in hk.pkl)
git hooks status       # Which hooks a repo declares vs what actually fires (manager, mechanism, identity guard, stale stubs); --json / --check (exit 2 when declared but unarmed) / --quiet (what `rs` calls). Reports only - arming is a deliberate act
mise run ts-checks     # Typecheck + test all first-party TS projects (installs deps as needed)
mise run py-checks     # Lint (ruff) + typecheck (pyrefly strict) + test all first-party Python; handoff also runs lint-imports + deptry
mise run skill-checks  # Run colocated skill-script tests (pytest/bats under <skill>/tests/, all tiers)
prose [path...]        # Lint markdown and code comments against the house rules (Vale, Connorads style); paths default to cwd, recursively. Always uses ~/.vale.ini, so house rules apply in any repo and beat its own .vale.ini. Non-zero on findings; vale absent = warn + exit 0
eraser <cmd> [args]    # Eraser diagrams: JSON in, PNG/HTML/measured-JSON out, rendered locally in Chromium (render|validate|registry|schema|init). Wrapper over `eraser-diagrams` that injects --no-config and pins Chromium; never call the bare CLI - see the function header for why
ccp [-y] [<name>|default]  # launch Claude Code on an account (bare = fzf picker; -y = cy flags: system-append + skip-perms); real names + 2-char aliases in ~/.zshrc.local
ccp [<name>] --mcp <bundle>  # ...plus an mcpz MCP bundle (delegates the claude exec to `mcpz run claude`); tmux prefix + Alt+c picks account + bundle → new window
claude-usage --all     # refresh usage for the default account + every ~/.claude-profiles/code/* profile
claude-watch [on|off|status]  # arm/disarm Claude auto-continue on a pane (tmux: prefix + T Tools)
mcpz list [--json]     # list MCP bundles (gitignored registry ~/.config/mcp/registry.local.json)
mcpz show <bundle>     # servers in a bundle, secrets redacted
mcpz render <agent> <bundle>       # print exact launch form; agent = claude|cc, codex, opencode|oc
mcpz run <agent> <bundle> [-- ...] # resolve secrets → env → exec agent with the bundle
mcpz                   # bare on a TTY: fzf-pick bundle + agent, then run
agent ls [--json]      # list live agent panes (pane/state/kind/name/loc/window/cwd), ranked
agent state <target>   # print a pane's @agent_state (target = %N | sess:win.pane | agent name)
agent wait <target> [--for s,s] [--timeout n]  # block until @agent_state reaches a state
agent prompt <target> <text> [--force]         # paste prompt + Enter, verify the agent starts
agent name [<target>] <name>                   # label a pane (unique among live agents); unname clears
agent pick             # fzf jump picker over live agents (tmux keys: prefix + A popup, Alt+a cycle)
agent goto <target>    # focus a pane by id, address or agent name; the picker's jump without the picker
coord                  # jump to the coordinator agent, launching it (codex in ~/git/coord) if absent; from inside it, return to the pane you came from (tmux: prefix + Alt+d). Launch spec ~/.config/coord/config, COORD_* env wins
coord status           # the coord pane, how it was found (name|window), and the recorded origin
agent hibernate [<target>] [--force]  # stop an idle Claude/Codex pane to reclaim RAM/swap and park a thawer in it; the conversation resumes in full on thaw. Only idle/done go without --force (refusal = exit 6)
agent thaw [<target>]  # resume a hibernated pane; bare = pick from parked panes plus orphaned records (a lost pane never strands its session)
agent auto status [--json] | agent auto off|observe|on  # pressure-gated auto-hibernation; tracked default observe. One mode gates two actors: the sweep policy (sustained CRITICAL, 24 h idle) and memwatch's emergency tier (heaviest idle/done pane on any CRITICAL tick or scheduler stall)
agent pin [<target>] | agent unpin [<target>]  # persist/remove a conversation-level auto-hibernation exclusion; manual hibernate stays available
atp [--host H] [--with-tree] [--window|--copy]  # teleport a live Claude/Codex session to another host: fork under a fresh id, ship over ssh, resume there; --with-tree also ships the working tree as a git bundle into a fresh worktree (tmux: prefix + Alt+t; alias for agent-teleport)
handoff --from claude --to codex <SESSION_ID>  # translate a session into the other agent's store and open it there (--no-open to translate only; both directions; also inspect/import/export/convert subcommands)
shotpath [host]        # save clipboard image locally or upload to host, then copy resulting path to clipboard
annotate list          # excerpts stashed for the next agent prompt; --json to script it
annotate send          # render the spool into one markdown draft, edit it, deliver it to the pane the excerpts came from (tmux: copy-mode `a` stashes, prefix + Alt+e opens the draft, prefix + Alt+Shift+E picks an untruncated Claude transcript message)
annotate send --to %19 # ...somewhere else; after `annotate undo` this re-aims a mis-targeted send with nothing retyped
annotate drop <n|last|all> | annotate clear | annotate render | annotate draft [--edit|--discard]
vox [--name <title>]   # record mic + system audio (Core Audio tap, no setup); `vox stop` transcribes locally and prints the recording's path (tmux: prefix + Alt+v starts/stops, prefix + Alt+Shift+V opens the picker)
vox cancel             # stop and discard, without transcribing
vox ls | vox last      # recording paths, newest first (`cat "$(vox last)/transcript.md"` is the whole integration story)
vox <file>             # transcribe an audio/video file that already exists
vox transcribe <path>  # re-run transcription on a recording, in place (what the picker's ctrl-t calls)
vox rename <path> <slug>   # retitle a recording, keeping its timestamp prefix
vox compact [--older 30d]  # WAV -> Opus 32k mono, preview + confirm (--dry-run/--force)
vox prune   [--older 90d]  # delete audio, keep transcripts (destructive; preview + confirm)
vox prune --empty          # delete only silent tracks, keeping the one that carries the recording
vox prune <path>...        # reclaim exactly the recordings you name (what the picker's ctrl-x calls)
ts                     # Tailscale wrapper (defined in .zshrc)
zellij                  # Alternative multiplexer (Nix-installed; config ~/.config/zellij/config.kdl)
svc ls                 # List agent services with status
svc up <name> [port]   # Start service + expose via Tailscale
svc down <name>        # Stop service + teardown Tailscale route
svc restart <name>     # Restart a service
svc ui                 # fzf service picker (default in TTY)
wt-add <branch>        # Create worktree under ~/.trees from the default branch (--base to override), run rs, print path (agent-callable)
wta <branch>           # wt-add + cd into it (human workflow)
wt-status [path]       # Report worktree status; --all / --json for agents; --pr adds real PR state from gh
wt-publish             # Push current worktree branch and optionally open a PR
wt-finish --mode local # Merge feature→base, remove worktree, delete branch
wt-finish --mode pr    # Push + open PR via wt-publish (worktree remains)
wt-clean [--all]       # Reap worktrees whose PR is MERGED (squash/rebase-aware) AND delete their branches; spares open/no-PR/dirty/unpushed. --force escalates to git branch -D. Preview+confirm; --dry-run/--json/--force/--include-closed/--yes
wt-remove [path]       # Non-interactive managed worktree removal primitive; keeps the branch unless --delete-branch
wti                    # Alias for `wt-status --all`
wtc                    # Alias for `wt-clean`
wtu                    # Human TUI: multi-select open/publish/remove; alt-R sweeps merged PRs via wt-clean
wts                    # fzf switch to a worktree (works outside git repos)
wt-prune               # Prune stale git worktree metadata after crashes/manual deletes
wt-repair [path...]    # Repair moved worktree metadata
ghcl [owner]           # fzf clone from GitHub (SSH)
ghcl-org <org>         # bulk-clone an org into cwd, flat (SSH, skips archived/forks); re-run to re-sync via pull --ff-only, default branch only. --dry-run/--json preview the plan; no tty needs --yes; orphans reported, never deleted
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

Detail lives in two files: mise, aube, `up` and the lockfile in [.config/mise/AGENTS.md](./.config/mise/AGENTS.md); per-manager quarantines, install scripts, osv-scanner and Homebrew cleanup in [docs/supply-chain.md](./docs/supply-chain.md).

**Nix**: flake.lock is the checkpoint. `nfu` updates it; `up` commits it. nixpkgs-unstable is correct for macOS (NixOS integration tests are irrelevant for nix-darwin).

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
