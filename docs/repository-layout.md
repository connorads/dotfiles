# Repository layout

## Coupled paths and gate wiring

[`~/src/pin-audit`](../src/pin-audit/) is the worked layout: TS implementation under `src/`, a thin dual-mode zsh wrapper in `.config/zsh/functions/`, a `zfn-link` symlink on `PATH`, and its CLI contract in `.config/zsh/tests/pin-audit.bats`.

Hard-coupled, staying put:

| Path | Why it cannot move |
| --- | --- |
| `.pi/agent/extensions` | pi composes the dir as `join(<agent dir>, "extensions")`. The `extensions` settings key is an enable/disable pattern list, not a search path; only `PI_CODING_AGENT_DIR` relocates it, and that drags auth + sessions too |
| `.config/nix/{voxtap,biokc,imagepaste}` | `${../voxtap/main.swift}` is a flake-root-relative path literal; nix copies only the flake dir to the store |
| `.hk-hooks` | `core.hooksPath` is set to `.hk-hooks` |
| `.claude/hooks` | Six scripts named by absolute path in `.claude/settings.json` |
| `.config/opencode/{plugin,plugins-v1,plugins-v2,plugin-disabled}` | `opencode.json`'s `plugin` array names each file by `file://` absolute path, so a moved file stops loading with no error. `.config/opencode/tsconfig.json` follows the code rather than the reverse: its `include` covers all four dirs |

Moving code between these trees is only safe once `mise run gate-coverage` passes. hk steps key on hard-coded path prefixes and fail **open**: a glob matching nothing exits 0, so a missed gate stops enforcing silently rather than failing the commit. A new `src/` project needs the `ts-typecheck-*` step, the `ts-tests-scoped` glob *and* `ts-tests.sh`'s `ROOTS` (Python: `py-typecheck-*`, the `py-tests-scoped` glob *and* `py-tests.sh`'s `ROOTS`), the `bats-scoped` glob *and* a `bats-tests.sh` case arm if it has a bats suite, `mise` checks, and a `.gitignore` un-ignore block.

## Configuration Files

Detail lives in each file's header comment or the linked subsystem doc.

| File | Purpose |
| --- | --- |
| [flake.nix](../.config/nix/flake.nix) | Main Nix config: macOS (nix-darwin), Linux (home-manager) |
| [modules/biokc.nix](../.config/nix/modules/biokc.nix) | Builds `biokc`, the Touch ID keychain helper gh-gate uses; desktop-only |
| [modules/imagepaste.nix](../.config/nix/modules/imagepaste.nix) | Builds `imagepaste`, which keeps clipboard GIF bytes for `shotpath` |
| [packages/terminal-control.nix](../.config/nix/packages/terminal-control.nix) | Builds `termctrl` (drive and render terminal apps in a real PTY); pairs with the `terminal-control` skill |
| [packages/footswitch.nix](../.config/nix/packages/footswitch.nix) | Builds `footswitch` for the foot pedal, driven by `pedal-flash`; desktop macOS only |
| [config.toml](../.config/mise/config.toml) | mise tools; maintenance: [.config/mise/AGENTS.md](../.config/mise/AGENTS.md) |
| [.config/srt/base.json](../.config/srt/base.json) | `agent-sandbox` (`asb`) OS sandbox policies; docs: [.config/srt/AGENTS.md](../.config/srt/AGENTS.md) |
| [.config/sbx/Dockerfile](../.config/sbx/Dockerfile) | Image for `sbx`: VM-isolated box for UNTRUSTED software. No host mounts, cap-drop ALL, offline by default |
| [.vale.ini](../.vale.ini) | Vale config for the house prose rules; applies to markdown and code comments |
| [.config/vale/styles/Connorads/](../.config/vale/styles/Connorads/) | The house style rules; tests: [vale-style.bats](../.config/zsh/tests/vale-style.bats) |
| [.oxlintrc.json](../.oxlintrc.json) | The tree's only oxlint config, type-aware rules on |
| [.config/opencode/package.json](../.config/opencode/package.json) | opencode plugin deps; opencode runs `bun install` on it, so the path is the interface |
| [.config/hex/hex.config.ts](../.config/hex/hex.config.ts) | HEX voice commands; HEX loads this path and reloads on save. `.hex-sdk` is HEX-managed and untracked; docs: [.config/hex/AGENTS.md](../.config/hex/AGENTS.md) |
| [.npmrc](../.npmrc), [.config/pnpm/config.yaml](../.config/pnpm/config.yaml), [.bunfig.toml](../.bunfig.toml), [.config/pip/pip.conf](../.config/pip/pip.conf), [.yarnrc.yml](../.yarnrc.yml) | Per-manager quarantine and install-script block; see [docs/supply-chain.md](../docs/supply-chain.md) |
| [.config/aube/config.toml](../.config/aube/config.toml) | aube, mise's npm backend: quarantine, trust policy, typosquat gates |
| [.zshrc](../.zshrc) | Shell config with aliases and autoloaded helpers |
| [.zshrc.local.example](../.zshrc.local.example) | Template for machine-local secrets in `~/.zshrc.local` |
| [kitty.conf](../.config/kitty/kitty.conf) | Terminal emulator config |
| [tmux.conf](../.config/tmux/tmux.conf) | tmux config; maintenance: [.config/tmux/AGENTS.md](../.config/tmux/AGENTS.md) |
| [help.md](../.config/tmux/help.md) | tmux keybindings cheatsheet (`Ctrl+b ?`) |
| [.claude/subagent-statusline.sh](../.claude/subagent-statusline.sh) | Model and context gauge on each row of Claude Code's agent panel; tests: [subagent-statusline.bats](../.config/zsh/tests/subagent-statusline.bats) |
| [tmux/scripts/mem-lib.sh](../.config/tmux/scripts/mem-lib.sh) | Memory-pressure states (OK/BUSY/CRITICAL) shared by the status gauge, popup and `memwatch` |
| [tmux/scripts/agent-state.sh](../.config/tmux/scripts/agent-state.sh) | Per-pane `@agent_state`. Agents: use `agent wait`/`agent ls`, don't scrape |
| [tmux/strategies/](../.config/tmux/strategies/) | Resurrect restore that resumes each Claude/Codex conversation. Already built - do not re-implement |
| [zsh/functions/macos/memwatch](../.config/zsh/functions/macos/memwatch) | launchd memory watcher; at CRITICAL it hibernates the heaviest idle agent pane. Log `~/.cache/memwatch.log` |
| [init.lua](../.config/nvim/init.lua) | Neovim config |
| [config.json](../.config/fresh/config.json) | Fresh terminal IDE config |
| [.fresh/config.json](../.fresh/config.json) | Fresh project config for this work-tree (shows hidden files) |
| [~/.config/zsh/functions/](../.config/zsh/functions/) | Custom shell functions (autoloaded in zsh, also on PATH) |
| [~/.local/bin/](../.local/bin/) | Symlinks to dual-mode zsh functions; includes `git-hunks` |
| [~/.local/bin/gh](../.local/bin/gh) | `gh` wrapper; keyring auth unless gh-gate token files exist |
| [~/.config/zsh/aliases/](../.config/zsh/aliases/) | Tool-specific aliases (sourced from `.zshrc`) |
| [~/.config/remobi/remobi.config.ts](../.config/remobi/remobi.config.ts) | remobi config ([connorads/remobi](https://github.com/connorads/remobi)) |
| [~/src/raycast/shotpath](../src/raycast/shotpath) | Raycast extension for `shotpath`; outside dot dirs because Raycast rejects hidden source paths |
| [~/src/dotfiles-docs](../src/dotfiles-docs/AGENTS.md) | "How I work" Starlight site; commit with `dotfiles commit -- src/dotfiles-docs` |
| [gh-gate](../.config/zsh/functions/git/gh-gate) | Scoped gh tokens via a GitHub App; `gh-gate --help` for setup |
| [mcpz](../.config/zsh/functions/agents/mcpz) | Render and launch MCP bundles per agent; docs: [.config/mcp/AGENTS.md](../.config/mcp/AGENTS.md) |
| [.config/vox/](../.config/vox/) | `vox` merge filter and vocabulary map; docs: [.config/tmux/docs/vox.md](../.config/tmux/docs/vox.md) |
| [~/src/handoff](../src/handoff/README.md) | `handoff` (Python). Tests: `cd ~/src/handoff && uv run --group dev pytest -c pyproject.toml` |
| [~/src/pin-audit](../src/pin-audit/) | `pin-audit` (bun/TS). Tests: `bun test` there, plus `pin-audit.bats` |
| [~/src/skl](../src/skl/CONTEXT.md) | `skl` (bun/TS); config `.config/skl/config.json`. Tests: `bun test` there, plus `skl-pick.bats` |
| [~/src/annotate](../src/annotate/CONTEXT.md) | `annotate` (bun/TS); log `~/.local/state/agents/annotate.jsonl`. Tests: `bun test` there, plus `annotate.bats`, `annotate-lib.bats` |
| [~/src/xreview](../src/xreview/CONTEXT.md)                              | `xreview`: headless, read-only review of a change, PR or plan by another agent (Codex when Claude calls, Claude when Codex does; `--reviewer codex,claude` for a panel). bun/TS, zero runtime deps, own [ADRs](../src/xreview/docs/adr/). One Review JSON document out, exit 0 approve / 1 needs-attention / 2 usage / 3 failed; `--post` creates a pending GitHub review. Read-only is enforced per reviewer (codex `-s read-only`; claude with no setting sources, `dontAsk` and its native sandbox), not asked for. Wrapper in `functions/agents`; skill `personal/xreview`. Tests: `cd ~/src/xreview && bun test`, plus `.config/zsh/tests/xreview.bats` (CLI contract, stubbed reviewers) |
| [~/src/raycast/skl](../src/raycast/skl/README.md) | Raycast extension over the `skl` catalogue; couples to the `~/.local/bin/skl` shim |
| `src/oyp/oyp.sh` | `oyp`: open the current PR in the terminal (via `.local/bin/oyp`) |

## Scripts

- [install.sh](../install.sh) - Bootstrap script for new machines
