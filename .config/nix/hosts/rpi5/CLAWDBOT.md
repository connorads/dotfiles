# Clawdbot on Raspberry Pi 5

Clawdbot AI assistant gateway running on NixOS (aarch64-linux).

## What is Clawdbot?

[Clawdbot](https://github.com/clawdbot/clawdbot) is an AI assistant gateway that connects messaging providers (Telegram, Discord) to AI backends (OpenAI, Anthropic). You message a bot, your machine does things.

## Setup

### 1. Create secrets directory

```bash
ssh connor@rpi5
mkdir -p ~/.secrets && chmod 700 ~/.secrets
```

### 2. Add OpenAI API key

```bash
echo "OPENAI_API_KEY=sk-your-key-here" > ~/.secrets/clawdbot.env
chmod 600 ~/.secrets/clawdbot.env
```

### 3. Set up Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Save the bot token:
   ```bash
   echo "your-bot-token" > ~/.secrets/telegram-bot-token
   chmod 600 ~/.secrets/telegram-bot-token
   ```

### 4. Get your Telegram user ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)

### 5. Enable Telegram in configuration.nix

Update `programs.clawdbot.instances.default.providers.telegram`:

```nix
providers.telegram = {
  enable = true;
  botTokenFile = "/home/connor/.secrets/telegram-bot-token";
  allowFrom = [ YOUR_USER_ID ];  # Replace with your Telegram user ID
};
```

### 6. Rebuild

```bash
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

The gateway serves a web UI at `http://rpi5:18789` (or via Tailscale at `http://rpi5.tailnet-name:18789`).

## Configuration

Current setup in `configuration.nix`:
- **AI Provider**: OpenAI (`openai/gpt-4o`)
- **Messaging**: Telegram (disabled until user ID configured)
- **Plugins**: All disabled (core gateway only)

## Links

- [Clawdbot](https://github.com/clawdbot/clawdbot) - upstream project
- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) - Nix packaging
- [Fork with aarch64-linux](https://github.com/connorads/nix-clawdbot/tree/feat/aarch64-linux) - RPi5 support
