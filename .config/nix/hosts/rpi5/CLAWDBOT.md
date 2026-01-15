# Clawdbot on Raspberry Pi 5

Clawdbot AI assistant gateway running on NixOS (aarch64-linux).

## What is Clawdbot?

[Clawdbot](https://github.com/clawdbot/clawdbot) is an AI assistant gateway that connects messaging providers (Telegram, Discord) to AI backends (OpenAI, Anthropic). You message a bot, your machine does things.

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

### 4. Rebuild on Pi

After deploying secrets, rebuild the NixOS config:

```bash
ssh connor@rpi5
sudo nixos-rebuild switch --flake 'github:connorads/dotfiles?dir=.config/nix#rpi5'
```

## Verify

```bash
# Check service status
systemctl --user status clawdbot-gateway

# View logs
journalctl --user -u clawdbot-gateway -f

# Restart if needed
systemctl --user restart clawdbot-gateway
```

## Web UI

The gateway serves a web UI at `http://rpi5:18789` (or via Tailscale).

## Configuration

Current setup in `configuration.nix`:
- **AI Provider**: OpenAI (`openai/gpt-4o`)
- **Messaging**: Telegram (user ID loaded at runtime via `$include`)
- **Plugins**: All disabled (core gateway only)

## Secrets

Secrets are stored in `/home/connor/.secrets/` on the Pi:
- `clawdbot.env` - OpenAI API key (`OPENAI_API_KEY=...`)
- `telegram-bot-token` - Telegram bot token
- `telegram-users.json` - Telegram user ID as JSON (loaded by clawdbot at runtime)

## Links

- [Clawdbot](https://github.com/clawdbot/clawdbot) - upstream project
- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) - Nix packaging
- [Fork with RPi5 support](https://github.com/connorads/nix-clawdbot/tree/feat/rpi5-complete) - aarch64-linux + allowFromFile
