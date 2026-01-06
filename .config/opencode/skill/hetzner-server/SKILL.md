---
name: hetzner-server
description: Create and manage Hetzner Cloud servers. Use when creating VPS/cloud servers, managing Hetzner infrastructure, or setting up dev/remote servers. Requires hcloud CLI.
---

# Hetzner Server Management

Create and manage Hetzner Cloud servers using the `hcloud` CLI.

## Prerequisites

- `hcloud` CLI installed (via mise: `hcloud = "latest"`)
- Authenticated: `hcloud context create <name>` with API token from https://console.hetzner.cloud

## Quick Reference

### Create a server

```bash
# ARM server (cheapest, recommended for dev)
hcloud server create \
  --name dev \
  --type cax11 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key connorads

# x86 server
hcloud server create \
  --name dev \
  --type cpx11 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key connorads

# IPv6-only (saves ~$0.60/month on IPv4)
hcloud server create \
  --name dev \
  --type cax11 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key connorads \
  --without-ipv4
```

### With user-data (auto-run install script)

```bash
hcloud server create \
  --name dev \
  --type cax11 \
  --image ubuntu-24.04 \
  --location nbg1 \
  --ssh-key connorads \
  --user-data-from-file <(echo '#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash')
```

### Common commands

```bash
# List servers
hcloud server list

# Get server IP
hcloud server ip dev

# SSH to server
ssh connor@$(hcloud server ip dev)

# Delete server
hcloud server delete dev

# Power operations
hcloud server poweroff dev
hcloud server poweron dev
hcloud server reboot dev

# Rebuild (reinstall OS, keeps IP)
hcloud server rebuild dev --image ubuntu-24.04
```

### Server types (commonly used)

Prices in USD for EU regions (US regions ~20% higher):

| Type | Arch | vCPU | RAM | Disk | ~USD/mo |
|------|------|------|-----|------|---------|
| cax11 | ARM | 2 | 4GB | 40GB | $4.50 |
| cax21 | ARM | 4 | 8GB | 80GB | $8 |
| cpx11 | x86 | 2 | 2GB | 40GB | $5.60 |
| cpx21 | x86 | 3 | 4GB | 80GB | $9 |

Full list: `hcloud server-type list`

### Locations

| ID | City | Country |
|----|------|---------|
| fsn1 | Falkenstein | DE |
| nbg1 | Nuremberg | DE |
| hel1 | Helsinki | FI |
| ash | Ashburn | US |
| hil | Hillsboro | US |
| sin | Singapore | SG |

### SSH keys

```bash
# List keys
hcloud ssh-key list

# Add a key
hcloud ssh-key create --name mykey --public-key-from-file ~/.ssh/id_ed25519.pub
```

### Images

```bash
# List system images
hcloud image list --type system

# ARM images
hcloud image list --type system --architecture arm
```

## Cloning GitHub repos (SSH agent forwarding)

Use SSH agent forwarding to clone private repos without copying keys to the server.

```bash
# First time only: add GitHub's host key
ssh connor@$(hcloud server ip dev) "ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null"

# Clone with agent forwarding (-A)
ssh -A connor@$(hcloud server ip dev) "git clone git@github.com:you/repo.git"

# Clone specific branch
ssh -A connor@$(hcloud server ip dev) "git clone git@github.com:you/repo.git && cd repo && git checkout branch-name"

# Push/pull with agent forwarding
ssh -A connor@$(hcloud server ip dev) "cd repo && git push"
```

For interactive sessions (e.g., lazygit):
```bash
ssh -A connor@$(hcloud server ip dev)
# Then on server: git clone/push/pull works with forwarded agent
```

## Notes

- ARM (cax*) servers are best value for dev work
- IPv6-only saves money but requires Tailscale/cloudflared for access from IPv4 networks
- User-data runs as root on first boot
- The dotfiles install.sh handles creating user `connor`, installing Nix, home-manager, and mise tools
