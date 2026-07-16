# Powerlevel10k instant prompt (must be at very top)
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Optional startup profiling: ZSH_PROFILE=1 zsh -i -c exit
[[ -n "${ZSH_PROFILE+1}" ]] && zmodload zsh/zprof

# Use a stable SSH agent socket inside tmux so long-lived panes survive
# reconnects. tmux's attach hook / `fixssh` repoint the symlink, but those miss
# socket rotation with no fresh attach (mosh roaming, re-attach to a persistent
# client). So also self-heal on a fresh SSH login: the first new shell after a
# reconnect repoints the symlink to the live forwarded socket, no manual fixssh.
if [[ -n "$SSH_CONNECTION" && -S "$SSH_AUTH_SOCK" && "$SSH_AUTH_SOCK" != "$HOME/.ssh/agent.sock" ]]; then
  ln -sf "$SSH_AUTH_SOCK" "$HOME/.ssh/agent.sock"
fi
if [[ -n "$TMUX" ]]; then
  export SSH_AUTH_SOCK="$HOME/.ssh/agent.sock"
fi

setopt HIST_IGNORE_SPACE
# Commands starting with a space are not saved to history.

# Key bindings for special keys (not provided by OMZ lib/key-bindings.zsh)
bindkey "^[[3~" delete-char

# https://github.com/mattmc3/antidote
ANTIDOTE_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/antidote"
[[ -d "$ANTIDOTE_HOME" ]] || git clone --depth=1 https://github.com/mattmc3/antidote.git "$ANTIDOTE_HOME"
source "$ANTIDOTE_HOME"/antidote.zsh

# Initialise completion system. Regenerate the dump — full compinit, including
# the slow security audit — at most once a day; otherwise trust the cache (-C).
# The staleness test must glob in array context: filename generation does not
# run inside [[ … ]], so the old `[[ -n …(#qN.mh+24) ]]` form was inert and
# compinit ran in full on every startup. (compinit must stay before `antidote
# load` so fzf-tab can wrap the completion widgets it sets up.)
autoload -Uz compinit
_zcompdump_fresh=( "${ZDOTDIR:-$HOME}/.zcompdump"(Nmh-24) )
if (( ${#_zcompdump_fresh} )); then
  compinit -C
else
  compinit
fi
unset _zcompdump_fresh

antidote load ${ZDOTDIR:-$HOME}/.zsh_plugins.txt

# fzf-tab configuration
zstyle ':completion:*:git-checkout:*' sort false
zstyle ':completion:*:descriptions' format '[%d]'
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza -1 --color=always $realpath'

# Custom functions (lazy-loaded via autoload)
typeset -U fpath
fpath=(
  ~/.config/zsh/functions
  ~/.config/zsh/functions/*(/N)
  $fpath
)
autoload -Uz ~/.config/zsh/functions/*(.N:t) ~/.config/zsh/functions/*/*(.N:t)

# Deferred completions (register on first prompt, then self-remove)
add-zsh-hook precmd _register_tmux_completions
add-zsh-hook precmd _register_completions

# https://github.com/jdx/mise
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi

# Keep the agent-sandbox shadow dir ahead of mise's install dirs so enrolled
# agents resolve to their sandbox wrapper (mise re-prepends each prompt; this
# runs after and wins). Inherited by subprocess execs an agent spawns.
typeset -U path
_agent_sandbox_shadow="$HOME/.local/share/shadow-bin"
_agent_sandbox_prepend() { [ -d "$_agent_sandbox_shadow" ] && path=( "$_agent_sandbox_shadow" $path ) }
_agent_sandbox_prepend
autoload -Uz add-zsh-hook
add-zsh-hook precmd _agent_sandbox_prepend
add-zsh-hook chpwd _agent_sandbox_prepend

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

# https://github.com/atuinsh/atuin
eval "$(atuin init zsh --disable-up-arrow)"

# https://github.com/anthropics/claude-code
export DISABLE_TELEMETRY=1
export DISABLE_ERROR_REPORTING=1
export CLAUDE_CODE_NO_FLICKER=1

# Surface a stale --channels patch (needle rename) left by claude-channels-patch
# --reapply, so an upstream flag rename can't be silently forgotten.
[[ -f "$HOME/.cache/claude-channels-patch.stale" ]] && \
  print -P "%F{yellow}claude-channels-patch:%f needle missing - see $HOME/.cache/claude-channels-patch.stale"

# Surface a stale computer-use patch (default-config reshape) the same way.
[[ -f "$HOME/.cache/claude-computer-use-patch.stale" ]] && \
  print -P "%F{yellow}claude-computer-use-patch:%f needle missing - see $HOME/.cache/claude-computer-use-patch.stale"

# Surface a stale session-reaper patch (liveness helper reshape) the same way.
[[ -f "$HOME/.cache/claude-session-reaper-patch.stale" ]] && \
  print -P "%F{yellow}claude-session-reaper-patch:%f needle missing - see $HOME/.cache/claude-session-reaper-patch.stale"

# https://donottrack.sh/
export DO_NOT_TRACK=1

# hyperframes/media-use skills: PostHog telemetry off (DO_NOT_TRACK also works;
# explicit var survives if upstream drops the generic check). Also gates the
# hyperframes-cli "report feedback after render" directive.
export HYPERFRAMES_NO_TELEMETRY=1
# ...and stop `npx hyperframes init` silently refreshing installed skills at
# scaffold time (--skip-skills is neutered upstream; only this var opts out).
# The full skill set is vendored + diff-reviewed in ~/.config/skills/vendor.
export HYPERFRAMES_SKIP_SKILLS=1

# micro editor true colour support
export MICRO_TRUECOLOR=1

# Homebrew supply chain: verify bottle provenance via Sigstore/GitHub attestations
[[ "$OSTYPE" == "darwin"* ]] && export HOMEBREW_VERIFY_ATTESTATIONS=1

# Startup profiling output (before p10k to avoid noise)
[[ -n "${ZSH_PROFILE+1}" ]] && zprof

# Powerlevel10k config (run `p10k configure` to regenerate)
[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh

# pnpm global bin (pnpm link --global)
[[ -d "$HOME/.local/share/pnpm" ]] && export PATH="$PATH:$HOME/.local/share/pnpm"

# Bun global bin (bun add -g)
[[ -d "$HOME/.bun/bin" ]] && export PATH="$PATH:$HOME/.bun/bin"

# Added by LM Studio CLI (lms)
[[ -d "$HOME/.lmstudio/bin" ]] && export PATH="$PATH:$HOME/.lmstudio/bin"
# End of LM Studio CLI section

# CF CLI completions
[[ -f "$HOME/.config/cf/completions/_cf.zsh" ]] && source "$HOME/.config/cf/completions/_cf.zsh"
