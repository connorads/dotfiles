# Clawdbot on Raspberry Pi 5

Clawdbot AI assistant gateway running on NixOS (aarch64-linux), installed via npm.

## What is Clawdbot?

[Clawdbot](https://github.com/clawdbot/clawdbot) is an AI assistant gateway that connects messaging providers (Telegram, Discord) to AI backends (OpenAI, Anthropic). You message a bot, your machine does things.

## Architecture

```
NixOS (base system)
├── Node.js 22 (via nixpkgs)
├── Tailscale (unchanged)
├── systemd user service for clawdbot
└── Home Manager for user config

Clawdbot (managed via npm)
├── ~/.clawdbot/clawdbot.json   (config - tracked in dotfiles)
├── ~/.clawdbot/.env            (secrets - NOT tracked)
├── ~/clawd/                    (workspace - backed up to GitHub)
└── ~/.secrets/                 (existing secrets - reused)
```

## Setup

### 1. Create a Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Save the bot token for the next step

### 2. Get your Telegram user ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)

### 3. Deploy secrets

From your Mac, run the secrets deploy script:

```bash
cd ~/.config/nix/hosts/rpi5
./secrets-deploy.sh --restart
```

This will prompt for:
- OpenAI API key (`sk-...`)
- Telegram bot token (`123456:ABC-xyz`)
- Telegram user ID (numeric, stored as JSON for runtime loading)

You can also deploy individual secrets:

```bash
./secrets-deploy.sh --openai           # Just OpenAI key
./secrets-deploy.sh --telegram         # Just Telegram token
./secrets-deploy.sh --telegram-id      # Just Telegram user ID
./secrets-deploy.sh --host 192.168.1.x # Use specific host/IP
```

### 4. Install Clawdbot on Pi

```bash
ssh connor@rpi5

# Configure npm to use local prefix (no sudo needed)
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global

# Install clawdbot
npm install -g clawdbot@latest

# Setup Tailscale Serve (if not already done)
tailscale serve --bg 18789
```

### 5. Start the service

```bash
systemctl --user daemon-reload
systemctl --user enable --now clawdbot-gateway
```

## Verify

```bash
# Check service status
systemctl --user status clawdbot-gateway

# View logs
journalctl --user -u clawdbot-gateway -f

# Restart if needed
systemctl --user restart clawdbot-gateway

# Health check
curl http://localhost:18789/health
```

**Note:** Over SSH, `systemctl --user` needs `XDG_RUNTIME_DIR`:
```bash
ssh -t connor@rpi5 "export XDG_RUNTIME_DIR=/run/user/\$(id -u) && systemctl --user status clawdbot-gateway"
```

## Upgrade Clawdbot

Simple npm upgrade:

```bash
ssh connor@rpi5
npm update -g clawdbot
systemctl --user restart clawdbot-gateway
```

## Web UI / Dashboard

Access via Tailscale Serve at `https://rpi5.<tailnet>.ts.net`.

### Authentication

Using token-based authentication. Token stored at `/home/connor/.secrets/clawdbot-gateway-token`.

**Dashboard access:**
```bash
ssh -t connor@rpi5 "export XDG_RUNTIME_DIR=/run/user/\$(id -u) && clawdbot dashboard --no-open"
```

Outputs URL: `https://rpi5.<tailnet>.ts.net/?token=<token>`

## Configuration

Config file: `~/.clawdbot/clawdbot.json` (tracked in dotfiles)

Current setup:
- **AI Provider**: OpenAI (`openai/gpt-5-nano`)
- **Messaging**: Telegram (user ID loaded at runtime)
- **Plugins**: All disabled (core gateway only)

## Secrets

Secrets stored in `/home/connor/.secrets/` on the Pi:
- `telegram-bot-token` - Telegram bot token
- `telegram-users.json` - Telegram user ID as JSON
- `clawdbot-gateway-token` - Token for dashboard/API auth

And in `~/.clawdbot/`:
- `.env` - OpenAI API key (`OPENAI_API_KEY=...`)

## Personality & Workspace

Workspace lives at `~/clawd/` containing:
- `SOUL.md` - Persona, tone, boundaries
- `IDENTITY.md` - Name, creature, vibe, emoji
- `AGENTS.md` - Operating instructions
- `USER.md` - How to address you

### Bootstrap Ritual

Personality questions are **not** asked during `clawdbot onboard`. Instead:

1. `clawdbot onboard` creates `BOOTSTRAP.md` (if workspace is brand new)
2. At end of onboarding, it prompts "hatch your bot now?" and sends `Wake up, my friend!`
3. Agent reads `BOOTSTRAP.md` and asks personality questions
4. You answer, agent populates `IDENTITY.md`, `USER.md`, `SOUL.md`
5. Delete `BOOTSTRAP.md` when done

### Workspace Backup

Auto-syncs daily to [connorads/clawd-workspace](https://github.com/connorads/clawd-workspace) (private) via systemd timer. Uses deploy key at `~/.ssh/clawd_deploy`.

Check timer status:
```bash
systemctl --user status clawd-workspace-sync.timer
```

### Dotfiles Sync

Config changes (like `~/.clawdbot/clawdbot.json`) are pulled automatically at 03:30 daily, before the NixOS auto-upgrade at 04:00.

Check timer status:
```bash
systemctl --user status dotfiles-sync.timer
```

Manual pull:
```bash
dotfiles pull
```

## Resetting

```bash
ssh connor@rpi5
clawdbot reset        # Wipes ~/.clawdbot/ (state, sessions)
clawdbot onboard --install-daemon
```

To redo personality: delete `~/clawd/` before onboard, or manually recreate `BOOTSTRAP.md`.

## Links

- [Clawdbot](https://github.com/clawdbot/clawdbot) - upstream project
