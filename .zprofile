# mise-en-place
export PATH="$HOME/.local/share/mise/shims:$PATH"

# Fix for Sublime Merge to work with git-lfs
if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# https://bitwarden.com/help/ssh-agent/
if [[ -S "$HOME/.bitwarden-ssh-agent.sock" ]]; then
    export SSH_AUTH_SOCK="$HOME/.bitwarden-ssh-agent.sock"
    if [[ "$(uname)" == "Darwin" ]]; then
        launchctl setenv SSH_AUTH_SOCK "$HOME/.bitwarden-ssh-agent.sock"
    fi
fi

# Custom functions (lazy-loaded via autoload)
typeset -U fpath
fpath=(
  ~/.config/zsh/functions
  ~/.config/zsh/functions/nix
  ~/.config/zsh/functions/git
  ~/.config/zsh/functions/tmux
  ~/.config/zsh/functions/tailscale
  ~/.config/zsh/functions/hetzner
  ~/.config/zsh/functions/agents
  ~/.config/zsh/functions/shell
  $fpath
)
autoload -Uz ~/.config/zsh/functions/*(.N:t) ~/.config/zsh/functions/*/*(.N:t)
