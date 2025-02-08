export PATH="$HOME/.local/share/mise/shims:$PATH"
# Fix for Sublime Merge to work with git-lfs
eval "$(/opt/homebrew/bin/brew shellenv)"

# https://bitwarden.com/help/ssh-agent/
if [[ -S "$HOME/.bitwarden-ssh-agent.sock" ]]; then
    export SSH_AUTH_SOCK="$HOME/.bitwarden-ssh-agent.sock"
    if [[ "$(uname)" == "Darwin" ]]; then
        launchctl setenv SSH_AUTH_SOCK "$HOME/.bitwarden-ssh-agent.sock"
    fi
fi
