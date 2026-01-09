# Source antigen if not already loaded (nix-darwin sources it in /etc/zshrc)
if ! typeset -f antigen > /dev/null; then
  if [[ -f ~/.nix-profile/share/antigen/antigen.zsh ]]; then
    source ~/.nix-profile/share/antigen/antigen.zsh
  elif [[ -f ~/.antigen/antigen.zsh ]]; then
    source ~/.antigen/antigen.zsh
  fi
fi

# https://github.com/zsh-users/antigen
antigen use oh-my-zsh
antigen theme spaceship-prompt/spaceship-prompt
antigen bundle git
antigen bundle aws
antigen bundle command-not-found
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/zsh-completions
antigen bundle zsh-users/zsh-syntax-highlighting
command -v brew >/dev/null 2>&1 && antigen bundle brew
antigen apply

# https://github.com/connorads/mise/
eval "$(mise activate zsh)"

# https://github.com/connorads/dotfiles/
alias dotfiles='git --git-dir=$HOME/git/dotfiles'


# https://github.com/NixOS/nix
alias nfu='nix flake update --flake ~/.config/nix'
alias ncg='nix-collect-garbage -d'
alias nfm='(cd ~/.config/nix && nix fmt ./flake.nix)'
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS - https://github.com/LnL7/nix-darwin
  alias drs='sudo darwin-rebuild switch --flake ~/.config/nix'
  alias up='mise upgrade && brew upgrade'
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux - https://github.com/nix-community/home-manager
  alias hms='home-manager switch --flake ~/.config/nix'
  alias up='mise upgrade'
fi

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

# git worktrees
wta() {
  local branch=$1
  local repo=$(basename $(git rev-parse --show-toplevel))
  local worktree_path="$HOME/.trees/${repo}-${branch}"

  # Check if branch exists locally or remotely
  if git show-ref --verify --quiet refs/heads/$branch; then
    # Local branch exists - checkout existing
    git worktree add "$worktree_path" "$branch" && cd "$worktree_path"
  elif git show-ref --verify --quiet refs/remotes/origin/$branch; then
    # Remote branch exists - track it
    git worktree add "$worktree_path" -b "$branch" "origin/$branch" && cd "$worktree_path"
  else
    # New branch - create from current HEAD
    git worktree add -b "$branch" "$worktree_path" && cd "$worktree_path"
  fi
}
alias wtl='git worktree list'
wts() {
  local worktree=$(git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2 | grep "^$HOME/.trees/" | fzf --prompt="Switch to worktree: ")

  if [[ -n "$worktree" ]]; then
    cd "$worktree"
  fi
}
wtrm() {
  local worktree=$(git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2 | grep "^$HOME/.trees/" | fzf --prompt="Select worktree to remove: ")

  if [[ -n "$worktree" ]]; then
    echo "Removing: $worktree"
    git worktree remove "$worktree" --force
  else
    echo "No worktree selected"
  fi
}

# tmux session management
tma() {
  local session_name="${1:-main}"
  if tmux has-session -t="$session_name" 2>/dev/null; then
    if [[ -z "$TMUX" ]]; then
      tmux attach -t "$session_name"
    else
      tmux switch-client -t "$session_name"
    fi
  else
    if [[ -z "$TMUX" ]]; then
      tmux new-session -s "$session_name"
    else
      tmux new-session -ds "$session_name" && tmux switch-client -t "$session_name"
    fi
  fi
}
tmk() {
  if ! tmux list-sessions &>/dev/null; then
    echo "No tmux sessions running"
    return 1
  fi
  echo "Current sessions:"
  tmux list-sessions
  echo
  read "session_name?Enter session name to kill: "
  if [[ -z "$session_name" ]]; then
    echo "No session specified"
    return 1
  fi
  if ! tmux has-session -t="$session_name" 2>/dev/null; then
    echo "Session '$session_name' not found"
    return 1
  fi
  read "confirm?Kill session '$session_name'? This will terminate all processes. [y/N]: "
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    tmux kill-session -t "$session_name"
    echo "Session '$session_name' killed"
  else
    echo "Cancelled"
  fi
}
tml() {
  tmux list-sessions 2>/dev/null || echo "No tmux sessions running"
}

# https://github.com/sst/opencode
alias oc='opencode'
alias ocy='config="$HOME/.config/opencode/opencode.json"; tmp="$(mktemp)"; jq ".permission.bash = {\"*\": \"allow\"} | .permission.external_directory = \"allow\"" "$config" > "$tmp" && mv "$tmp" "$config"'
alias ocn='git --git-dir=$HOME/git/dotfiles --work-tree=$HOME checkout HEAD -- .config/opencode/opencode.json'
ocm() {
  local cfg="$HOME/.config/opencode/opencode.json"
  local sel=$(jq -r '.mcp|keys[]' "$cfg" | fzf -m --prompt="MCPs to enable > ")
  [[ -z "$sel" ]] && return
  local tmp=$(mktemp)
  local filter='.mcp |= with_entries(.value.enabled = false)'
  while IFS= read -r mcp; do
    filter="$filter | .mcp[\"$mcp\"].enabled = true"
  done <<< "$sel"
  jq "$filter" "$cfg" > "$tmp" && mv "$tmp" "$cfg"
}

alias syncskills='unison "$HOME/.claude/skills" "$HOME/.config/opencode/skill" -ignore "Name .DS_Store"'

# https://github.com/jesseduffield/lazygit
alias lg='lazygit --use-config-dir ~/.config/lazygit'
alias lgdf='lg --git-dir="$HOME/git/dotfiles" --work-tree="$HOME"'