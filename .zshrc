# Powerlevel10k instant prompt (must be at very top)
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

setopt HIST_IGNORE_SPACE
# Commands starting with a space are not saved to history.

# https://github.com/mattmc3/antidote
ANTIDOTE_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/antidote"
[[ -d "$ANTIDOTE_HOME" ]] || git clone --depth=1 https://github.com/mattmc3/antidote.git "$ANTIDOTE_HOME"
source "$ANTIDOTE_HOME"/antidote.zsh

# Initialise completion system before loading plugins that use compdef
autoload -Uz compinit && compinit

antidote load ${ZDOTDIR:-$HOME}/.zsh_plugins.txt

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

# tmux completions
add-zsh-hook precmd _register_tmux_completions

# https://github.com/jdx/mise
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi

# Aliases (grouped by tool)
for alias_file in ~/.config/zsh/aliases/*.zsh(N); do
  source "$alias_file"
done

# Machine-local config + helpers
# Use .zshrc.local for config that shouldn't be committed
# (API keys, PATH additions, etc.)
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# https://github.com/ajeetdsouza/zoxide
eval "$(zoxide init zsh)"

# https://github.com/anthropics/claude-code
export DISABLE_TELEMETRY=1
export DISABLE_ERROR_REPORTING=1

# Powerlevel10k config (run `p10k configure` to regenerate)
[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh

# Added by LM Studio CLI (lms)
[[ -d "$HOME/.lmstudio/bin" ]] && export PATH="$PATH:$HOME/.lmstudio/bin"
# End of LM Studio CLI section
