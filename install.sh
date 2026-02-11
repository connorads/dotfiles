#!/bin/bash
# Dotfiles install script
# Works on: GitHub Codespaces, Linux as root (creates connor user), Linux as regular user
# Usage: curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash

set -e

DOTFILES_REPO="https://github.com/connorads/dotfiles.git"
DOTFILES_DIR="$HOME/git/dotfiles"
TARGET_USER="connor"

IN_CODESPACES=false
if [ "${CODESPACES:-}" = "true" ]; then
  IN_CODESPACES=true
  echo "Setting up dotfiles for GitHub Codespaces (full Nix + home-manager)..."
fi

IN_NIXOS=false
if [ -f /etc/NIXOS ]; then
  IN_NIXOS=true
  echo "Detected NixOS - Nix already installed, skipping Nix/Docker install..."
fi

# --- Linux as root: create user and re-run ---
if [ "$(id -u)" = "0" ]; then
  echo "Running as root, setting up $TARGET_USER user..."

  if ! id "$TARGET_USER" &>/dev/null; then
    echo "Creating user $TARGET_USER..."
    useradd -m -s /bin/bash "$TARGET_USER"
    echo "$TARGET_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$TARGET_USER"
    chmod 440 "/etc/sudoers.d/$TARGET_USER"
  fi

  # Copy SSH authorized_keys
  if [ -f /root/.ssh/authorized_keys ]; then
    echo "Copying SSH keys to $TARGET_USER..."
    mkdir -p "/home/$TARGET_USER/.ssh"
    cp /root/.ssh/authorized_keys "/home/$TARGET_USER/.ssh/"
    chown -R "$TARGET_USER:$TARGET_USER" "/home/$TARGET_USER/.ssh"
    chmod 700 "/home/$TARGET_USER/.ssh"
    chmod 600 "/home/$TARGET_USER/.ssh/authorized_keys"
  fi

  echo "Re-running script as $TARGET_USER..."
  exec sudo -u "$TARGET_USER" bash -c "curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash"
fi

# --- Linux as regular user ---
echo "Setting up dotfiles for Linux..."

# Clone dotfiles if not present
if [ ! -d "$DOTFILES_DIR" ]; then
  echo "Cloning dotfiles..."
  mkdir -p "$(dirname "$DOTFILES_DIR")"
  git clone --bare "$DOTFILES_REPO" "$DOTFILES_DIR"

  cd "$DOTFILES_DIR"
  git config --unset core.bare
  git config core.worktree "$HOME"

  cd "$HOME"
  # Backup any conflicting files
  git --git-dir="$DOTFILES_DIR/" checkout 2>&1 | grep -E "^\s+" | awk '{print $1}' | while read -r file; do
    if [ -f "$file" ]; then
      echo "Backing up $file to $file.bak"
      mv "$file" "$file.bak"
    fi
  done
  git --git-dir="$DOTFILES_DIR/" checkout -f
else
  echo "Dotfiles already present, pulling latest..."
  git --git-dir="$DOTFILES_DIR/" --work-tree="$HOME" pull || true
fi

# Install Nix if not present (skip on NixOS - already has Nix)
if [ "$IN_NIXOS" = "true" ]; then
  echo "NixOS detected - Nix already available"
elif ! command -v nix &>/dev/null; then
  echo "Installing Nix..."

  if [ "$IN_CODESPACES" = "true" ]; then
    # Codespaces has known ACL weirdness on /tmp that breaks Nix builds.
    if command -v apt-get &>/dev/null; then
      echo "Ensuring /tmp ACLs won't break Nix builds..."
      sudo apt-get update -y
      sudo apt-get install -y acl xz-utils
      sudo setfacl -k /tmp || true
    fi

    # Codespaces: install single-user Nix (no daemon) to avoid systemd.
    # Also disable sandbox to avoid seccomp/container issues.
    tmp_nix_conf="$(mktemp)"
    cat >"$tmp_nix_conf" <<'EOF'
experimental-features = nix-command flakes
sandbox = false
EOF

    curl -L https://nixos.org/nix/install | sh -s -- --no-daemon --yes --nix-extra-conf-file "$tmp_nix_conf"
    rm -f "$tmp_nix_conf"

    mkdir -p "$HOME/.config/nix"
    if ! grep -q "^experimental-features = .*nix-command" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
      printf '%s\n' "experimental-features = nix-command flakes" >>"$HOME/.config/nix/nix.conf"
    fi
    if ! grep -q "^sandbox = false$" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
      printf '%s\n' "sandbox = false" >>"$HOME/.config/nix/nix.conf"
    fi
  else
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm
  fi

  # Source nix for this session (best-effort across install modes)
  if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  elif [ -f /nix/var/nix/profiles/default/etc/profile.d/nix.sh ]; then
    . /nix/var/nix/profiles/default/etc/profile.d/nix.sh
  elif [ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    . "$HOME/.nix-profile/etc/profile.d/nix.sh"
  fi

  export PATH="/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/per-user/$USER/profile/bin:$HOME/.nix-profile/bin:$PATH"
else
  echo "Nix already installed"
fi

# Install Docker if not present (skip on NixOS - managed by NixOS config)
if [ "$IN_CODESPACES" = "true" ]; then
  echo "Skipping Docker install in Codespaces"
elif [ "$IN_NIXOS" = "true" ]; then
  echo "Skipping Docker install on NixOS - managed by NixOS config"
else
  if ! command -v docker &>/dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh

    if ! groups "$USER" | grep -q docker; then
      sudo usermod -aG docker "$USER"
      echo "Added $USER to docker group (log out and back in to use docker without sudo)"
    fi

    echo "Optional: For rootless Docker (more secure), run: dockerd-rootless-setuptool.sh install"
    echo "See: https://docs.docker.com/engine/security/rootless/"
  else
    echo "Docker already installed: $(docker --version)"

    if command -v systemctl &>/dev/null && ! sudo systemctl is-active --quiet docker; then
      sudo systemctl start docker
    fi

    if ! groups "$USER" | grep -q docker; then
      sudo usermod -aG docker "$USER"
      echo "Added $USER to docker group (log out and back in to use docker without sudo)"
    fi
  fi
fi

# Run home-manager (skip on NixOS - managed by nixos-rebuild)
if [ "$IN_NIXOS" = "true" ]; then
  echo "Skipping home-manager switch on NixOS - run 'nrs' (nixos-rebuild switch) instead"
elif [ "$IN_CODESPACES" = "true" ]; then
  echo "Running home-manager switch..."
  nix run home-manager/master -- switch --flake ~/.config/nix#codespace
else
  echo "Running home-manager switch..."
  nix run home-manager/master -- switch --flake ~/.config/nix
fi

# Install system-level tailscaled (kernel TUN mode, needed for ts serve)
# Skip on NixOS (managed by NixOS config) and Codespaces (no systemd)
if [ "$IN_NIXOS" = "false" ] && [ "$IN_CODESPACES" = "false" ] && command -v systemctl &>/dev/null; then
  TAILSCALED_BIN="$HOME/.nix-profile/bin/tailscaled"
  UNIT_FILE="/etc/systemd/system/tailscaled.service"

  if [ -x "$TAILSCALED_BIN" ] && [ ! -f "$UNIT_FILE" ]; then
    echo "Installing system tailscaled service (kernel TUN mode)..."

    # Stop userspace tailscaled if running
    systemctl --user stop tailscaled 2>/dev/null || true
    systemctl --user disable tailscaled 2>/dev/null || true

    sudo tee "$UNIT_FILE" > /dev/null << EOF
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/kb/
Wants=network-pre.target
After=network-pre.target NetworkManager.service systemd-resolved.service

[Service]
ExecStart=$TAILSCALED_BIN --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock
ExecStopPost=$TAILSCALED_BIN --cleanup
Restart=on-failure
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
StateDirectory=tailscale
StateDirectoryMode=0700
CacheDirectory=tailscale
CacheDirectoryMode=0750
Type=notify

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable --now tailscaled

    TAILSCALE_BIN="$HOME/.nix-profile/bin/tailscale"
    if [ -x "$TAILSCALE_BIN" ]; then
      # Wait for tailscaled socket to be ready
      for i in $(seq 1 10); do
        [ -S /run/tailscale/tailscaled.sock ] && break
        sleep 1
      done
      sudo "$TAILSCALE_BIN" set --operator="$USER"
    fi
    echo "tailscaled running with TUN. Run 'tsup' to authenticate."
  elif [ -f "$UNIT_FILE" ]; then
    echo "System tailscaled already installed"
  fi
fi

# Install tools via mise (skip on NixOS - use Nix packages instead)
if [ "$IN_NIXOS" = "true" ]; then
  echo "Skipping mise install on NixOS - tools managed by NixOS config"
else
  # Ensure common build deps exist so mise/python-build can compile CPython with
  # core stdlib modules enabled (notably zlib, which is required for ensurepip).
  if command -v apt-get &>/dev/null && command -v dpkg &>/dev/null; then
    pkgs=(
      build-essential
      pkg-config
      zlib1g-dev
      libssl-dev
      libbz2-dev
      libreadline-dev
      libsqlite3-dev
      libffi-dev
      liblzma-dev
      libncursesw5-dev
      libgdbm-dev
      libgdbm-compat-dev
      uuid-dev
      tk-dev
      xz-utils
    )

    missing=()
    for pkg in "${pkgs[@]}"; do
      if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        missing+=("$pkg")
      fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
      echo "Installing system packages required for building Python (apt-get)..."
      sudo apt-get update -y
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
    fi
  fi

  echo "Installing tools via mise..."
  export PATH="/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/per-user/$USER/profile/bin:$HOME/.nix-profile/bin:/etc/profiles/per-user/$USER/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

  if ! command -v mise &>/dev/null; then
    echo "Installing mise..."
    curl -fsSL https://mise.run | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi

  if [ "$IN_CODESPACES" = "true" ]; then
    export MISE_ENV=codespaces
    echo "mise: env=codespaces"
  fi

  mise install
fi

# Install browser binaries for Playwright and agent-browser (if available via mise)
if command -v playwright &>/dev/null; then
  echo "Installing Playwright browsers and system deps..."
  playwright install --with-deps
fi

if command -v agent-browser &>/dev/null; then
  echo "Installing agent-browser browsers..."
  agent-browser install --with-deps
fi

# Install TPM (tmux plugin manager) and plugins
if [ ! -d "$HOME/.config/tmux/plugins/tpm" ]; then
  echo "Installing TPM (tmux plugin manager)..."
  git clone --depth 1 https://github.com/tmux-plugins/tpm "$HOME/.config/tmux/plugins/tpm"
fi

echo "Installing tmux plugins via TPM..."
"$HOME/.config/tmux/plugins/tpm/bin/install_plugins"

# Set zsh as default shell
ZSH_PATH="$HOME/.nix-profile/bin/zsh"
if [ "$IN_CODESPACES" = "true" ]; then
  echo "Skipping default shell change in Codespaces"
elif [[ -x "$ZSH_PATH" && "$SHELL" != "$ZSH_PATH" ]]; then
  echo "Changing default shell to zsh..."
  sudo chsh -s "$ZSH_PATH" "$USER"
fi

echo ""
echo "Done! Restart your shell or run: exec zsh"
