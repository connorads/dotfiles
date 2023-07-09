#!/bin/bash

DOTFILES_DIR=$HOME/git/dotfiles

# Change worktree to home directory
cd $DOTFILES_DIR
git config --unset core.bare
git config core.worktree $HOME

# Put dotfiles from git into home directory (⚠️ this will overwrite existing dotfiles in home directory)
cd $HOME
git checkout -f --git-dir=$DOTFILES_DIR/

# Install https://brew.sh
if ! command -v brew &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install brew packages
brew bundle install