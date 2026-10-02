# Command reference

## Common Commands

Run `<cmd> --help` for flags and subcommands.

```bash
drs | hms | nrs        # rebuild: darwin (macOS) | home-manager (Linux) | nixos; add r (drsr...) to roll back
up                     # update everything: bump + commit mise.lock and flake.lock, brew/apt, rebuild
up -s                  # frozen rebuild; clean mise.lock required, dirty flake.lock allowed; no bumps/commit
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
mcpz                   # MCP bundles: list, show, render, run per agent
agent <sub>            # live agent panes: ls, state, wait, prompt, name, pick, goto, hibernate, thaw, auto, pin
atp                    # teleport a live Claude/Codex session to another host
handoff                # translate a session between Claude Code and Codex
shotpath [host]        # save or upload the clipboard image, copy its path
vox                    # record mic + system audio; `vox stop` transcribes locally
vox grab [5m]          # the live call so far, while recording (prefix + Alt+y copies it)
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
lazydocker             # container TUI
```

### ccp account config inheritance

`CLAUDE_CONFIG_DIR` fully relocates the user scope, so a `ccp` account would
otherwise read none of the shared `~/.claude` config. Each launch (and resurrect
restore) runs [`claude-profile-materialise`](../.config/zsh/functions/claude-profile-materialise),
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

Shell commands run by coding agents are recorded in atuin with `--author <agent>`,
in a separate DB: `~/.local/share/atuin/agents.db` (records in `agents-records.db`).
[`atuin-agent`](../.config/zsh/functions/agents/atuin-agent) is `atuin` with
`ATUIN_DB_PATH` and `ATUIN_RECORD_STORE_PATH` pointed there; use it to query agent
history. Claude Code and Codex call it via hook entries (`atuin-agent hook
claude-code|codex`) in [.claude/settings.json](../.claude/settings.json) /
[.codex/hooks.json](../.codex/hooks.json), pi via
[.pi/agent/extensions/atuin.ts](../.pi/agent/extensions/atuin.ts). All three
configs are dotfiles-tracked, so machines inherit on pull; atuin ≥18.17 (nix-owned)
is required. `history.db` holds only your own commands, so Ctrl+R never scans agent
rows: its `$all-user` filter is a `CASE` expression no index serves.

```bash
atuin-agent search --author '$all-agent' -- 'wt-'    # what agents actually run
atuin-agent search --author claude-code --format '{intent} | {command}' -- ''  # Bash description lands as intent
```

Caveats:

- Codex requires per-machine hook trust (`/hooks` in the codex TUI), and again
  whenever a hook's command text changes; trust state lives in
  `.codex/config.toml` and is machine-local (clean filter strips it). Untrusted
  hooks are silently skipped - no capture until trusted.
- Codex has no `PostToolUseFailure` event; that entry in `hooks.json` is inert
  there and mirrors the `atuin hook install codex` layout.
- `atuin hook install <agent>` rewrites the whole config with its own formatting
  and writes plain `atuin hook ...` commands, which would log to `history.db` -
  hand-edit tracked files instead.
- The pi extension is version-coupled to the atuin binary and locally modified to
  call `atuin-agent`: after major atuin upgrades, re-run `atuin hook install pi`,
  diff, and keep the `ATUIN_BIN` edit.

## Tracked Files

To list all tracked dotfiles:

```bash
dotfiles ls-files
```
