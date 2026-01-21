setopt HIST_IGNORE_SPACE
# Commands starting with a space are not saved to history.

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

# https://github.com/jdx/mise
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
  alias mt='mise trust'
  alias mi='mise install'
fi

# https://github.com/connorads/dotfiles/
dotfiles() {
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" "$@"
}


# https://github.com/NixOS/nix
nfu() { nix flake update --flake ~/.config/nix; }
ncg() { nix-collect-garbage -d; }
nfm() { (cd ~/.config/nix && nix fmt ./flake.nix); }
# macOS - https://github.com/LnL7/nix-darwin
drs() { sudo darwin-rebuild switch --flake ~/.config/nix; }
drsr() { drs --rollback; }
# Linux - https://github.com/nix-community/home-manager
hms() { home-manager switch --flake ~/.config/nix; }
hmsr() { hms --rollback; }
# NixOS - https://nixos.org/
nrs() { sudo nixos-rebuild switch --flake ~/.config/nix; }
nrsr() { nrs --rollback; }

# https://github.com/clawdbot/clawdbot
alias cbs='~/.config/nix/hosts/rpi5/nix-clawdbot-sync.sh'

# Tailscale helpers
# - macOS uses /var/run/tailscale/tailscaled.sock
# - Linux user-mode uses $XDG_RUNTIME_DIR/tailscale/tailscaled.sock

ts() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "tailscale not installed" >&2
    return 127
  fi

  if [[ "$OSTYPE" == "darwin"* ]] \
    && [[ -S "/var/run/tailscale/tailscaled.sock" ]]; then
    command tailscale --socket "/var/run/tailscale/tailscaled.sock" "$@"
  elif [[ "$OSTYPE" == "linux-gnu"* ]] \
    && [[ -n "$XDG_RUNTIME_DIR" ]] \
    && [[ -S "$XDG_RUNTIME_DIR/tailscale/tailscaled.sock" ]]; then
    command tailscale --socket "$XDG_RUNTIME_DIR/tailscale/tailscaled.sock" "$@"
  else
    command tailscale "$@"
  fi
}

tsup() {
  emulate -L zsh
  setopt err_return

  if [[ "$OSTYPE" == "darwin"* ]]; then
    local socket_path="/var/run/tailscale/tailscaled.sock"

    if command -v launchctl >/dev/null 2>&1; then
      sudo launchctl kickstart -k system/com.tailscale.tailscaled 2>/dev/null || true
    fi

    for _ in {1..20}; do
      [[ -S "$socket_path" ]] && break
      sleep 0.2
    done

    if [[ ! -S "$socket_path" ]]; then
      echo "tailscaled not running (missing $socket_path)" >&2
      return 1
    fi

    sudo tailscale --socket "$socket_path" up --accept-dns=true --ssh "$@"
    return
  fi

  if [[ "$OSTYPE" == "linux-gnu"* ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user start tailscaled 2>/dev/null || true
  fi

  if [[ "$OSTYPE" == "linux-gnu"* ]] && [[ -n "$XDG_RUNTIME_DIR" ]]; then
    local socket_path="$XDG_RUNTIME_DIR/tailscale/tailscaled.sock"
    for _ in {1..20}; do
      [[ -S "$socket_path" ]] && break
      sleep 0.2
    done
  fi

  ts up --accept-dns=true --ssh "$@"
}

up() {
  mise upgrade
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew update && brew upgrade
  fi

  nfu

  dotfiles add ~/.config/nix/flake.lock
  if ! dotfiles diff --cached --quiet -- ~/.config/nix/flake.lock; then
    dotfiles commit -m "chore(nix): update flake lock"
  fi

  if [[ "$OSTYPE" == "darwin"* ]]; then
    drs
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    hms
  fi
}

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

# Machine-local config + helpers
# Use .zshrc.local for config that shouldn't be committed
# (API keys, PATH additions, etc.)
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# Initialise/edit machine-local API keys quickly.
# - Creates ~/.zshrc.local from ~/.zshrc.local.example if missing
# - Opens in micro (or $EDITOR/vi)
zshrc-local() {
  local example_file="$HOME/.zshrc.local.example"
  local local_file="$HOME/.zshrc.local"

  if [[ ! -f "$local_file" ]]; then
    if [[ ! -f "$example_file" ]]; then
      echo "Missing $example_file" >&2
      return 1
    fi

    umask 077
    cp "$example_file" "$local_file" || return 1
    chmod 600 "$local_file" || true
  fi

  if command -v micro >/dev/null 2>&1; then
    micro "$local_file"
  else
    "${EDITOR:-vi}" "$local_file"
  fi

  source "$local_file"
}

# Export secrets without putting them on the command line.
# Usage: secretexport GITHUB_TOKEN
secretexport() {
  emulate -L zsh
  setopt localoptions noxtrace

  local name="$1"
  if [[ -z "$name" ]]; then
    echo "usage: secretexport VAR_NAME" >&2
    return 1
  fi

  if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "invalid variable name: $name" >&2
    return 1
  fi

  local value
  read -rs "value?${name}: "
  echo
  typeset -gx "$name=$value"
  unset value
}

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

# https://github.com/chmouel/lazyworktree
alias lwt='lazyworktree'

# git worktrees
wta() {
  local branch=$1
  local repo=$(basename $(git rev-parse --show-toplevel))
  local worktree_path="$HOME/.trees/${repo}-${branch}"

  git fetch origin

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

# Hetzner Cloud SSH helpers
# hcs  = connect as connor (default)
# hcsr = connect as root
_hcloud_ssh() {
  local user="$1"
  shift
  if [[ -n "$1" ]]; then
    local ip=$(hcloud server list -o columns=name,ipv4 -o noheader | awk -v srv="$1" '$1==srv {print $2}')
    if [[ -n "$ip" ]]; then
      ssh "${user}@${ip}"
    else
      echo "Server '$1' not found" >&2
      return 1
    fi
    return
  fi
  local line=$(hcloud server list -o columns=name,ipv4 -o noheader | fzf --prompt="SSH as ${user} to: ")
  if [[ -n "$line" ]]; then
    local ip=$(echo "$line" | awk '{print $2}')
    ssh "${user}@${ip}"
  fi
}
hcs()  { _hcloud_ssh connor "$@"; }
hcsr() { _hcloud_ssh root "$@"; }

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

skillsync() {
  # conversation-analysis is OpenCode-only; do not sync it to other agents
  echo "[skillsync] claude <-> opencode"
  echo "[skillsync] tips: l=left r=right d=delete s=skip ?=help"
  unison "$HOME/.claude/skills" "$HOME/.config/opencode/skills" -ignore "Name .DS_Store" -ignore "Name .system" -ignore "Name conversation-analysis" && \
  echo "[skillsync] opencode <-> codex" && \
  echo "[skillsync] tips: l=left r=right d=delete s=skip ?=help" && \
  unison "$HOME/.codex/skills" "$HOME/.config/opencode/skills" -ignore "Name .DS_Store" -ignore "Name .system" -ignore "Name conversation-analysis" && \
  echo "[skillsync] codex <-> claude" && \
  echo "[skillsync] tips: l=left r=right d=delete s=skip ?=help" && \
  unison "$HOME/.codex/skills" "$HOME/.claude/skills" -ignore "Name .DS_Store" -ignore "Name .system"
}

# claude code auth for codespaces (uses tmux to handle interactive auth)
cda() {
  # Select codespace via fzf
  local cs=$(gh codespace list --json name,repository,state \
    --jq '.[] | select(.state=="Available") | "\(.name)\t\(.repository)"' \
    | fzf --prompt="Codespace for Claude auth: " --with-nth=1..)

  [[ -z "$cs" ]] && return

  local name=$(echo "$cs" | cut -f1)

  echo "Starting Claude auth in codespace tmux session..."

  # Start claude in a tmux session (source zshrc for mise PATH)
  gh codespace ssh -c "$name" -- 'zsh -c "source ~/.zshrc; tmux kill-session -t claude-auth 2>/dev/null; tmux new-session -d -s claude-auth -x 120 -y 40 zsh; tmux send-keys -t claude-auth claude Enter"'

  # Wait for auth URL to appear (poll tmux output)
  local auth_url=""
  echo "Waiting for auth URL..."
  for i in {1..30}; do
    sleep 1
    local output=$(gh codespace ssh -c "$name" -- 'zsh -c "source ~/.zshrc; tmux capture-pane -t claude-auth -p"' 2>/dev/null)

    # Check if we need to press Enter for theme/login selection
    if echo "$output" | grep -q "Choose the text style"; then
      gh codespace ssh -c "$name" -- 'zsh -c "source ~/.zshrc; tmux send-keys -t claude-auth Enter"' 2>/dev/null
      continue
    fi
    if echo "$output" | grep -q "Select login method"; then
      gh codespace ssh -c "$name" -- 'zsh -c "source ~/.zshrc; tmux send-keys -t claude-auth Enter"' 2>/dev/null
      continue
    fi

    # Look for the auth URL (join wrapped lines first)
    auth_url=$(echo "$output" | tr -d '\n' | grep -oE 'https://claude\.ai/oauth/authorize\?[^[:space:]]+' | head -1)
    if [[ -n "$auth_url" ]]; then
      break
    fi

    # Check if already logged in
    if echo "$output" | grep -q "What can I help you with"; then
      echo "Claude is already logged in!"
      gh codespace ssh -c "$name" -- 'zsh -c "source ~/.zshrc; tmux kill-session -t claude-auth"' 2>/dev/null
      return 0
    fi
  done

  if [[ -z "$auth_url" ]]; then
    echo "Could not detect auth URL. Check tmux session manually:"
    echo "  gh codespace ssh -c '$name' -- 'tmux attach -t claude-auth'"
    return 1
  fi

  # Open auth URL in local browser
  echo "Opening auth URL..."
  open "$auth_url" 2>/dev/null || xdg-open "$auth_url" 2>/dev/null || echo "Open: $auth_url"

  echo ""
  echo "Complete auth in browser. You'll get a code to paste."
  echo "To paste the code, run:"
  echo "  gh codespace ssh -c '$name' -- -t 'zsh -ilc \"tmux attach -t claude-auth\"'"
}

# https://github.com/jesseduffield/lazygit
alias lg='lazygit --use-config-dir ~/.config/lazygit'
alias lgdf='lg --git-dir="$HOME/git/dotfiles" --work-tree="$HOME"'

# Type: cpcmd <what you want>
# It will ask Copilot for ONE command and paste it into your prompt (so you can review before running).
cpcmd() {
  local q="$*"
  if [[ -z "$q" ]]; then
    echo "usage: cpcmd <task description>" >&2
    return 1
  fi

  local cmd
  cmd="$(copilot -p "Suggest a single zsh/bash command to: ${q}. Output ONLY the command. No backticks. No explanation.")"

  # Insert into the current command line buffer
  if [[ -n "$cmd" ]]; then
    print -z -- "$cmd"
  fi
}
