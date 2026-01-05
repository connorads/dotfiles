#!/bin/bash
# GitHub Codespaces dotfiles install script
# https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account#dotfiles

set -e

if [ "$CODESPACES" != "true" ]; then
  echo "Not running in GitHub Codespaces."
  echo "See README.md for setup instructions."
  exit 0
fi

echo "Setting up dotfiles for GitHub Codespaces..."

# Install mise
echo "Installing mise..."
curl -fsSL https://mise.run | sh
export PATH="$HOME/.local/bin:$PATH"

# Install tools from config
echo "Installing tools via mise..."
mise install

# Install antigen for zsh
if [ ! -d "$HOME/.antigen" ]; then
  echo "Installing antigen..."
  git clone --depth 1 https://github.com/zsh-users/antigen.git "$HOME/.antigen"
fi

# Source antigen in .zshrc
# TODO: Find a nicer way to source antigen - this is a bit hacky
if ! grep -q "antigen.zsh" "$HOME/.zshrc"; then
  echo "Adding antigen source to .zshrc..."
  echo 'source ~/.antigen/antigen.zsh' | cat - "$HOME/.zshrc" > /tmp/.zshrc.tmp && mv /tmp/.zshrc.tmp "$HOME/.zshrc"
fi

echo "Done! Restart your shell or run: exec zsh"
