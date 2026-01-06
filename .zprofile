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
