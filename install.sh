#!/bin/bash
# Dotfiles install script
# Works on: GitHub Codespaces, Linux as root (creates connor user), Linux as regular user
# Usage: curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash

set -e

DOTFILES_REPO="https://github.com/connorads/dotfiles.git"
DOTFILES_DIR="$HOME/git/dotfiles"
TARGET_USER="connor"

# --- Codespaces ---
if [ "$CODESPACES" = "true" ]; then
  echo "Setting up dotfiles for GitHub Codespaces..."

  echo "Installing mise..."
  curl -fsSL https://mise.run | sh
  export PATH="$HOME/.local/bin:$PATH"

  echo "Installing tools via mise..."
  mise install

  if [ ! -d "$HOME/.antigen" ]; then
    echo "Installing antigen..."
    git clone --depth 1 https://github.com/zsh-users/antigen.git "$HOME/.antigen"
  fi

  echo "Done! Restart your shell or run: exec zsh"
  exit 0
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

# Install Nix if not present
if ! command -v nix &>/dev/null; then
  echo "Installing Nix..."
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm

  # Source nix for this session
  if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  elif [ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    . "$HOME/.nix-profile/etc/profile.d/nix.sh"
  fi
else
  echo "Nix already installed"
fi

# Install Docker if not present
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

# Run home-manager
echo "Running home-manager switch..."
nix run home-manager/master -- switch --flake ~/.config/nix

# Install tools via mise
echo "Installing tools via mise..."
export PATH="$HOME/.nix-profile/bin:$HOME/.local/share/mise/shims:$PATH"
mise install

# Set zsh as default shell
ZSH_PATH="$HOME/.nix-profile/bin/zsh"
if [[ -x "$ZSH_PATH" && "$SHELL" != "$ZSH_PATH" ]]; then
  echo "Changing default shell to zsh..."
  sudo chsh -s "$ZSH_PATH" "$USER"
fi

echo ""
echo "Done! Restart your shell or run: exec zsh"
