#!/usr/bin/env bash
# nvim_persistence.sh: tmux-resurrect strategy for Neovim + persistence.nvim
# Launches nvim and loads the persisted session for the working directory.
# persistence.nvim indexes by cwd + git branch, so resurrect's directory
# restore provides the correct context automatically.

echo 'nvim -c "lua require('"'"'persistence'"'"').load()"'
