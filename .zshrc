# https://github.com/zsh-users/antigen
command -v antigen >/dev/null || source "$(brew --prefix)/share/antigen/antigen.zsh"
antigen use oh-my-zsh
antigen theme spaceship-prompt/spaceship-prompt
antigen bundle brew
antigen bundle git
antigen bundle aws
antigen bundle command-not-found
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/zsh-completions
antigen bundle zsh-users/zsh-syntax-highlighting
antigen apply

# https://github.com/connorads/mise/
eval "$(mise activate zsh)"

# https://github.com/connorads/dotfiles/
alias dotfiles='git --git-dir=$HOME/git/dotfiles'

# https://github.com/LnL7/nix-darwin
alias drs='sudo darwin-rebuild switch --flake ~/.config/nix'
alias nfu='nix flake update --flake ~/.config/nix'
alias ncg='sudo nix-collect-garbage -d'

# Function to create a prompt to review a GitHub PR
pr-prompt() {
  local url=$1
  if [[ $url != https://github.com/*/pull/* ]]; then
    echo "usage: gh-pr-prompt <PR-url>" >&2
    return 1
  fi

  local owner_repo pr_number
  owner_repo=${url#https://github.com/}
  owner_repo=${owner_repo%/pull/*}
  pr_number=${url##*/}

  {
    echo "Please review this PR: $url"
    echo
    echo "## Description"
    gh pr view "$url" -R "$owner_repo" --json body \
      --jq '.body // "No description provided"'

    echo
    echo "## Diff"
    gh pr diff "$url" -R "$owner_repo"

    echo
    echo "## Comments"
    gh api "repos/$owner_repo/issues/$pr_number/comments?per_page=100" --paginate \
      --jq '.[] | "\(.user.login) (\(.created_at)):\n\(.body)\n---"' 2>/dev/null || true

  } | pbcopy

  echo "✅ PR review prompt copied to clipboard"
}

# Source machine-specific configuration if it exists
# Use .zshrc.local for PATH additions or other config
# that shouldn't be committed to version control
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# https://github.com/ajeetdsouza/zoxide
eval "$(zoxide init zsh)"

# Easily view usage limits
alias claude-usage='open "https://claude.ai/settings/usage"'
alias codex-usage='open "https://chatgpt.com/codex/settings/usage"'
alias copilot-usage='open "https://github.com/settings/copilot/features"'

# git helpers
alias gom='gsta -m "auto-stash before gom" && gswm && ggpull'
alias gomu='gom && gstp'
alias gob='git switch -'
alias gobu='gob && gstp'

# https://github.com/sst/opencode
alias oc='opencode'
