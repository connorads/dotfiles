# NixOS on Raspberry Pi 5

## Overview

This config uses [nixos-raspberrypi](https://github.com/nvmd/nixos-raspberrypi) for Pi 5 kernel and firmware support.

**Why two steps?** Ideally we'd build one image with everything (connor user, home-manager, full config). But `nixos-raspberrypi`'s bootloader module conflicts with the upstream sd-image module's extlinux bootloader - you can't combine them. So we use a two-step process:

1. **Build installer image** - minimal NixOS with `nixos` user and your SSH keys baked in
2. **Deploy full config** - boot, SSH in, run `nixos-rebuild switch` to deploy your actual config

The flake has:
- `nixosConfigurations.rpi5` - your running system config
- `installerImages.rpi5` - the bootstrap installer image

## Build Installer Image

Build the installer with SSH keys baked in (uses linux-builder VM on Mac):

```bash
cd ~/.config/nix
nix build .#installerImages.rpi5
```

Extract and flash:

```bash
zstd -d result/sd-image/*.img.zst -o rpi5.img
# Flash to USB drive (check disk number with: diskutil list)
diskutil unmountDisk disk4
sudo dd if=rpi5.img of=/dev/rdisk4 bs=4M status=progress
diskutil eject disk4
```

## First Boot

1. Plug USB drive into Pi 5, power on
2. Find IP: `nmap -sn 192.168.1.0/24` or check router DHCP leases
3. SSH in as `nixos` (keys from github.com/connorads.keys baked in):
   ```bash
   ssh nixos@<pi-ip>
   ```
4. Deploy full config:
   ```bash
   sudo nixos-rebuild switch --flake ~/.config/nix#rpi5
   ```

After rebuild, SSH as `connor@<pi-ip>` (the user in your config).

## Post-boot Setup

Run install script (clones dotfiles, installs mise tools):

```bash
curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash
```

The script detects NixOS and skips Nix/home-manager install (NixOS manages those).

Set up Tailscale:

```bash
sudo tailscale up --ssh
```

## Updating the Pi

### From the Pi itself

```bash
nrs  # alias for: sudo nixos-rebuild switch --flake ~/.config/nix
```

### Remotely from Mac (once on Tailscale)

```bash
nixos-rebuild switch \
  --flake ~/.config/nix#rpi5 \
  --build-host connor@rpi5 \
  --target-host connor@rpi5 \
  --use-remote-sudo
```

## SSH Key Updates

SSH keys are fetched from `github.com/connorads.keys` at build time.

If you add/remove keys on GitHub, update the hash and rebuild:

```bash
nix-prefetch-url https://github.com/connorads.keys
# Update sha256 in:
#   - hosts/rpi5/configuration.nix (for running system)
#   - flake.nix installerImages.rpi5 (for installer image)
nrs  # or remote rebuild
```

## Fallback: Generic Installer

If you can't build the custom installer image:

1. Build generic installer (no SSH keys, random credentials):
   ```bash
   nix build github:nvmd/nixos-raspberrypi#installerImages.rpi5
   ```
2. Boot Pi with HDMI connected - random credentials shown on screen
3. SSH in with those credentials, then:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash
   sudo nixos-rebuild switch --flake ~/.config/nix#rpi5
   ```
