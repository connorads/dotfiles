# AGENTS.md

`~/CLAUDE.md` → `~/AGENTS.md` (project/dotfiles), `~/.claude/CLAUDE.md` → `~/.agents/AGENTS.md` (user). Canonical files are `AGENTS.md` - use `dotfiles add AGENTS.md` when committing changes.

## Task Guides

Read the matching guide before changing a subsystem. Load other references only
when the task needs them.

| Task | Guide |
| --- | --- |
| Find a config, add a project or move source | [Repository layout](./docs/repository-layout.md) |
| Find a command or inspect agent account/history wiring | [Command reference](./docs/commands.md) |
| Change a shell function or its PATH entry | [Shell functions](./docs/shell-functions.md) |
| Write or run shell tests | [.config/zsh/tests/AGENTS.md](./.config/zsh/tests/AGENTS.md) |
| Change Nix targets, Xcode or package ownership | [System platforms](./docs/system-platforms.md) |
| Change mise tools, aube, lockfiles or `up` | [.config/mise/AGENTS.md](./.config/mise/AGENTS.md) |
| Change package quarantine or install-script controls | [Supply chain](./docs/supply-chain.md) |
| Change Git guards, hooks or check coverage | [.hk-hooks/AGENTS.md](./.hk-hooks/AGENTS.md) |
| Add, update or promote skills | [.config/skills/AGENTS.md](./.config/skills/AGENTS.md) |
| Change tmux behaviour | [.config/tmux/AGENTS.md](./.config/tmux/AGENTS.md) |
| Change MCP bundles | [.config/mcp/AGENTS.md](./.config/mcp/AGENTS.md) |
| Change agent sandbox policies | [.config/srt/AGENTS.md](./.config/srt/AGENTS.md) |
| Expose a service or run remote commands | [Remote access](./docs/remote-access.md) |

System overview: [README.md](./README.md). Decision records: [docs/adr/README.md](./docs/adr/README.md).
Use the `adr` skill for decision-record format and mechanics.
Subprojects keep their own ADRs, for example [skl](./src/skl/docs/adr/).
The rpi5 system configuration is a separate [repository](https://github.com/connorads/rpi5).

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

Before moving code, read the [coupled paths and gate wiring](./docs/repository-layout.md).
Run `mise run gate-coverage` after moves; a hook glob matching nothing exits 0.

## Git Hygiene

- Ignore unrelated git changes; do not reset/revert/discard them.
- Treat Codex `[projects.*]` trust entries, hook trust state, marketplace timestamps, app-injected MCP/browser wiring, desktop UI preferences, notice state, accessibility probe state, and model picker keys (`model`, `model_reasoning_effort`, `plan_mode_reasoning_effort`) in [`.codex/config.toml`](./.codex/config.toml) as machine-local state; never commit them. A `codex-config` clean filter strips or normalises them on commit.
- Treat Pi model picker keys (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`) in [`.pi/agent/settings.json`](./.pi/agent/settings.json) as machine-local state; never commit them. A `pi-agent-settings` clean filter normalises them and restores the final newline on commit.
- Treat the `model` key in [`.claude/settings.json`](./.claude/settings.json) as machine-local state - Claude Code's `/model` picker writes it back with no opt-out (since v2.1.153; `s` in the picker is session-only). A `claude-settings` clean filter strips it on commit, and sorts keys (`jq -S`) so the reordering Claude Code does on every rewrite stays out of git; permission arrays keep their authored order.
- Use `dotfiles` commands for dotfiles git operations so config renormalisation (Codex, Claude, and Pi settings clean filters) runs before status/diff/stash.
- Vendored `src/` subprojects (`handoff`, `pin-audit`, `skl`, `xreview`, `raycast/shotpath`, `raycast/skl`) are tracked in the dotfiles work-tree, not standalone repos. Never `git init` inside one - it creates a nested repo and double-tracks every file. Commit their changes with `dotfiles`.

## Verification by Change

Run checks from the work-tree root unless the command names a project directory.
Start with `dhk check <changed paths>` and the matching row below. Report checks
as passed, failed or skipped; a hook that skips a missing tool is not verification.

| Change | Checks | Coverage limit |
| --- | --- | --- |
| Shell behaviour | Relevant Bats files; follow [.config/zsh/tests/AGENTS.md](./.config/zsh/tests/AGENTS.md) | `zsh-tests-fast` excludes integration tests; missing Bats can skip the hook |
| TypeScript | Affected project's test script and typecheck; hook details in [.hk-hooks/AGENTS.md](./.hk-hooks/AGENTS.md) | Missing tools or dependencies can skip checks |
| Python | Affected project's pytest and typecheck; `mise run py-checks` includes flat script suites | Not every flat script suite runs at commit time; missing tools can skip checks |
| Nix configuration | `bash .hk-hooks/nix-eval.sh` and scoped Nix lint | Cross-host evaluation does not prove builds or activation |
| Code moves or gate wiring | `mise run gate-coverage`, affected suites and `dhk test` for changed hk steps | A matching path does not prove behaviour; inspect the hook plan too |
| Documentation | Scoped Markdown/prose checks and `dhk check --step link-check` | Local file destinations only; no external URLs, heading anchors or factual claims; missing lychee skips |

## Supply Chain & Update Strategy

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

## Git Hooks (hk)

- `core.hooksPath` is `.hk-hooks`; pre-commit runs `hk run pre-commit -q` from `~/hk.pkl`.
- The `amends`/`import` pin in `hk.pkl` must name the same version as the mise-installed `hk`. A mismatch makes builtin steps fail with `no command for test`. `dhk` and the pre-commit hook resolve hk through `mise -C $HOME`, so a project's own hk on PATH does not override the pin.
- `dhk check`, `dhk fix`, `dhk test` (the steps' own `tests {}` blocks).
- Gates fail open: a glob that matches nothing exits 0. After moving code between trees, run `mise run gate-coverage`.
- There is deliberately no pre-push gate. `git push` holds the GitHub connection open while pre-push runs, and GitHub drops it before a whole-suite run ends. Run `mise run zsh-tests` by hand.

Gate-by-gate detail: [.hk-hooks/AGENTS.md](./.hk-hooks/AGENTS.md).

## Agent Skills

Before adding, removing, vendoring, or promoting skills, read
[`~/.config/skills/AGENTS.md`](./.config/skills/AGENTS.md).

The catalogue is the default; load its skills on demand with `skl`. The curation
guide owns installation, reviewed updates and promotion to autoload.
Bookmarked skills live in [.agents/README.md](./.agents/README.md).
The agents-root decision is recorded in [ADR 0002](./docs/adr/0002-agents-root.md).

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

## Network safety

Use `ts` rather than raw `tailscale`; the wrapper handles platform socket paths.
Bind local dev servers to `127.0.0.1` or `localhost`. Expose that loopback port
through `tsp` / `svc` when needed. See [remote access](./docs/remote-access.md).

## Keeping Docs Updated

After changing paths, commands or ownership, search current-state documentation
for the old claims. Verify replacements against source, configuration or observed
behaviour. Replace duplicated procedures with links to their canonical owner.
The [living-documentation reconciliation workflow](./skills/living-documentation/references/rituals.md)
describes how to check hand-maintained claims.

Update the owning documentation:

- This file (`AGENTS.md`) - for standing rules and task routes
- The relevant subsystem guide - for commands, configuration and procedures
- [README.md](./README.md) - for changes to the dotfiles system itself
