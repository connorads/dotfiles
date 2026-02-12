# agentbox

Isolated Docker sandbox for coding agents. Agents can commit freely; you review and push from the host.

## Quick start

```bash
agentbox build                          # build image (auto-builds on first use)
agentbox ~/my-project                   # start with shell, attach to tmux
agentbox -c "fix the auth bug" ~/proj   # start Claude Code with prompt
agentbox -o "add tests" ~/proj          # start OpenCode with prompt
```

## Commands

```
agentbox [flags] [dir]    Start container and attach to tmux
agentbox attach [name]    Attach to running container's tmux
agentbox shell [name]     Open shell in running container
agentbox stop [name]      Stop and remove container
agentbox build            Force rebuild the image
agentbox list             List running agentbox containers
```

### Start flags

| Flag | Short | Description |
|------|-------|-------------|
| `--claude "prompt"` | `-c` | Run Claude Code with `--dangerously-skip-permissions` |
| `--opencode "prompt"` | `-o` | Run OpenCode with prompt |
| `--firewall` | | Enable network firewall (off by default) |
| `--name NAME` | | Container name (default: `agentbox`) |

## What's inside

**Agents:** Claude Code (npm), OpenCode (install script)

**Tools:** git, gh (unauthenticated), tmux, fzf, ripgrep, delta, jq, zsh, curl, build-essential

**User:** `agent` (UID 1000) with zsh, matching typical host UID for bind-mount compatibility

## Security model

**Commit freely, push from host.** The container has `.gitconfig` (identity for commits) but no SSH keys and no `gh` auth. The project directory is bind-mounted, so commits write directly to the host's `.git`. Review and push from the host:

```bash
cd ~/my-project
git log --oneline        # see agent's commits
git diff HEAD~3          # review changes
git push origin branch   # push with your credentials
```

### What's mounted

| Mount | Target | Mode |
|-------|--------|------|
| Project dir | `/workspace` | rw |
| `~/.claude/` | `/home/agent/.claude` | rw (token refresh) |
| `~/.gitconfig` | `/home/agent/.gitconfig` | ro |
| `~/.config/opencode/` | `/home/agent/.config/opencode` | ro (if exists) |
| `~/.local/share/opencode/` | `/home/agent/.local/share/opencode` | ro (if exists) |
| `agentbox-history` volume | `/commandhistory` | rw |

### What's NOT mounted

- `~/.ssh/` — no SSH keys
- `~/.config/gh/` — no GitHub auth

### Firewall (`--firewall`)

Off by default (agents often need to install packages). When enabled, uses iptables default-deny with whitelisted destinations:

- DNS, localhost, host network
- `api.anthropic.com`, `statsig.anthropic.com`, `statsig.com`, `sentry.io`
- `api.openai.com`
- GitHub IPs (fetched from `api.github.com/meta`)
- `registry.npmjs.org`, `pypi.org`, `crates.io`

Requires `--cap-add=NET_ADMIN --cap-add=NET_RAW` (added automatically).

## Session management

Agents run inside a tmux session (`main`). Detach with `Ctrl+b d` — the container stays alive. Reattach with `agentbox attach`. Open a separate shell with `agentbox shell`.

## Multiple containers

```bash
agentbox --name frontend -c "fix CSS" ~/web-app
agentbox --name backend -o "add endpoint" ~/api
agentbox list              # see both
agentbox attach frontend   # reattach to one
agentbox stop backend      # stop the other
```

## Colima

Works with Colima (no Docker Desktop required). For best performance on Apple Silicon:

```bash
colima start --vm-type vz --mount-type virtiofs
```

## Rebuilding

```bash
agentbox build   # force rebuild (e.g. after updating Dockerfile)
```

The image auto-builds on first `agentbox` invocation if missing. Rebuild manually to pick up agent version updates or Dockerfile changes.
