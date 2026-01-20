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

**Note:** Over SSH, `systemctl --user` needs `XDG_RUNTIME_DIR`:
```bash
ssh -t connor@rpi5 "export XDG_RUNTIME_DIR=/run/user/\$(id -u) && systemctl --user status clawdbot-gateway"
```

## Remote Rebuild from Mac

Push dotfiles changes to GitHub, then rebuild the Pi:
```bash
ssh connor@rpi5 "sudo nixos-rebuild switch --flake 'github:connorads/dotfiles?dir=.config/nix#rpi5' --no-write-lock-file --refresh"
```

The `--refresh` flag ensures latest is pulled from GitHub.

## Upgrade Clawdbot (version bump)

Clawdbot versions are pinned in the `nix-clawdbot` fork. The sync script can now update pins when needed.

```bash
cd ~/.config/nix/hosts/rpi5
./nix-clawdbot-sync.sh --update-pins
```

Then update the dotfiles lock and rebuild the Pi:

```bash
cd ~/.config/nix
nix flake lock --update-input nix-clawdbot
git --git-dir=~/git/dotfiles --work-tree=$HOME commit -am "bump nix-clawdbot pins"
git --git-dir=~/git/dotfiles --work-tree=$HOME push
ssh connor@rpi5 "sudo nixos-rebuild switch --flake 'github:connorads/dotfiles?dir=.config/nix#rpi5' --refresh"
```

## Web UI

Access via Tailscale Serve at `https://rpi5.<tailnet>.ts.net` (authenticated via Tailscale identity).

## Configuration

Current setup in `configuration.nix`:
- **AI Provider**: OpenAI (`openai/gpt-5-nano`)
- **Messaging**: Telegram (user ID loaded at runtime via `$include`)
- **Plugins**: All disabled (core gateway only)

## Secrets

Secrets are stored in `/home/connor/.secrets/` on the Pi:
- `clawdbot.env` - OpenAI API key (`OPENAI_API_KEY=...`)
- `telegram-bot-token` - Telegram bot token
- `telegram-users.json` - Telegram user ID as JSON (loaded by clawdbot at runtime)

**Safe to reset**: These are external files - `clawdbot reset` won't touch them. The Nix config regenerates service configuration on rebuild, so Telegram/gateway settings are declarative.

## Personality & Workspace

Workspace lives at `~/clawd/` containing:
- `SOUL.md` - Persona, tone, boundaries
- `IDENTITY.md` - Name, creature, vibe, emoji
- `AGENTS.md` - Operating instructions
- `USER.md` - How to address you

### Bootstrap Ritual

Personality questions ("what's my name?", "pick an emoji") are **not** asked during `clawdbot onboard`. Instead:

1. `clawdbot onboard` creates `BOOTSTRAP.md` (if workspace is brand new)
2. At end of onboarding, it prompts "hatch your bot now?" and sends `Wake up, my friend!`
3. Agent reads `BOOTSTRAP.md` and asks personality questions
4. You answer, agent populates `IDENTITY.md`, `USER.md`, `SOUL.md`
5. Delete `BOOTSTRAP.md` when done (or agent keeps trying to bootstrap)

To re-trigger bootstrap manually, send `Wake up, my friend!` via TUI or Telegram (requires `BOOTSTRAP.md` to exist).

### Workspace Backup

Auto-syncs daily to [connorads/clawd-workspace](https://github.com/connorads/clawd-workspace) (private) via systemd timer. Uses deploy key at `~/.ssh/clawd_deploy`.

## Resetting

```bash
ssh connor@rpi5
clawdbot reset        # Wipes ~/.clawdbot/ (state, sessions)
clawdbot onboard --install-daemon
```

To redo personality: delete `~/clawd/` before onboard, or manually recreate `BOOTSTRAP.md`.

## Links

- [Clawdbot](https://github.com/clawdbot/clawdbot) - upstream project
- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) - Nix packaging
- [Fork with RPi5 support](https://github.com/connorads/nix-clawdbot/tree/feat/rpi5-complete) - aarch64-linux + allowFromFile
